// D-020 A8：pluginVersion 读 package.json——硬编码版本会随发版漂移
// （对照上游 0.1.0-alpha.13 的同名修复）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as plugin from '../src/index.js'

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

// 假 helper：发 READY 后把 stdin 收到的消息原样落到 HELLO_LOG。
function writeHelperFixture(dir) {
  const script = join(dir, 'ready-helper.cjs')
  writeFileSync(script, `
const fs = require('node:fs')
process.stdout.write(JSON.stringify({ protocolVersion: 1, kind: 'ready' }) + '\\n')
process.stdin.resume()
process.stdin.on('data', (chunk) => fs.appendFileSync(process.env.HELLO_LOG, chunk))
process.stdin.on('end', () => process.exit(0))
`.trimStart())
  return script
}

function createCtx() {
  const state = {}
  const cleanups = []
  const settings = {
    register(name, schema, opts) {
      Object.assign(state, opts?.base ?? {})
      return {
        get: () => ({ ...state }),
        update: async (patch) => { Object.assign(state, patch) },
        watch: () => () => {},
      }
    },
  }
  const logger = { info() {}, warn() {}, error() {}, debug() {} }
  const inject = (deps, cb) => cb({
    logger,
    settings,
    webServer: { register: () => () => {} },
    effect: (fn) => { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
    inject,
  })
  const ctx = {
    logger,
    settings,
    on: () => () => {},
    inject,
    effect: (fn) => { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
  }
  return { ctx, cleanups }
}

function waitFor(predicate, timeoutMs = 10000) {
  const started = Date.now()
  return new Promise((resolvePromise, reject) => {
    const check = () => {
      if (predicate()) return resolvePromise()
      if (Date.now() - started > timeoutMs) return reject(new Error('timed out waiting for condition'))
      setTimeout(check, 20)
    }
    check()
  })
}

test('pluginVersion() returns the package.json version', () => {
  assert.equal(typeof plugin.pluginVersion, 'function', 'index 应导出 pluginVersion()')
  assert.equal(plugin.pluginVersion(), packageJson.version)
})

test('HELLO sent to the helper carries the package.json version (no hardcoded literal)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-version-'))
  const logPath = join(dir, 'stdin.jsonl')
  const script = writeHelperFixture(dir)
  const { ctx, cleanups } = createCtx()
  try {
    plugin.apply(ctx, {
      enabled: true,
      helper: { command: process.execPath, args: [script], env: { HELLO_LOG: logPath }, headless: true },
    })
    await waitFor(() => existsSync(logPath) && readFileSync(logPath, 'utf8').includes('"kind":"hello"'))
    const messages = readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
    const hello = messages.find((message) => message.kind === 'hello')
    assert.ok(hello, 'helper 应收到 HELLO')
    assert.equal(hello.pluginVersion, packageJson.version)
  } finally {
    for (const cleanup of cleanups) cleanup()
  }
})
