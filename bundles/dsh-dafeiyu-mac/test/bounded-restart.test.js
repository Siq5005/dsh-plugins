// D-020 A5：helper 重启有界——坏 helper 不再无限重启（对照上游 0.1.0-alpha.14 / 0.1.5 #40）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HelperProcess } from '../src/helper-process.js'

const silent = { info() {}, warn() {}, error() {}, debug() {} }

function captureLogger() {
  const entries = []
  return {
    logger: {
      info: (m) => entries.push(m),
      warn: (m) => entries.push(m),
      error: (m) => entries.push(m),
      debug: (m) => entries.push(m),
    },
    entries,
  }
}

function readCounter(file) {
  if (!existsSync(file)) return 0
  return Number(readFileSync(file, 'utf8'))
}

// 自包含 fixture：用 node 自身当 fake helper，记录每次 spawn 到计数文件。
function writeFixtures(dir) {
  const crash = join(dir, 'crash.cjs')
  writeFileSync(crash, `
const fs = require('node:fs')
const p = process.env.ATTEMPT_FILE
const n = (fs.existsSync(p) ? Number(fs.readFileSync(p, 'utf8')) : 0) + 1
fs.writeFileSync(p, String(n))
process.exit(3)
`.trimStart())
  // 前 2 次运行直接退出（READY 前失败），之后发 READY 并驻留到 stdin 关闭。
  const flaky = join(dir, 'flaky.cjs')
  writeFileSync(flaky, `
const fs = require('node:fs')
const p = process.env.ATTEMPT_FILE
const n = (fs.existsSync(p) ? Number(fs.readFileSync(p, 'utf8')) : 0) + 1
fs.writeFileSync(p, String(n))
if (n < 3) process.exit(1)
process.stdout.write(JSON.stringify({ protocolVersion: 1, kind: 'ready' }) + '\\n')
process.stdin.resume()
process.stdin.on('end', () => process.exit(0))
`.trimStart())
  return { crash, flaky }
}

function waitFor(predicate, timeoutMs = 8000) {
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

test('bounded restart: a helper that never reaches READY stops retrying after maxStartFailures spawns', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-bound-'))
  const attempt = join(dir, 'attempts')
  const { crash } = writeFixtures(dir)
  const { logger, entries } = captureLogger()
  const hp = new HelperProcess({
    command: process.execPath,
    args: [crash],
    env: { ATTEMPT_FILE: attempt },
    headless: true,
    restartDelayMs: 30,
    maxStartFailures: 3,
  }, logger)
  try {
    hp.start()
    // 连续失败 3 次后应放弃：restartSuppressed = true。
    await waitFor(() => hp.restartSuppressed === true)
    assert.equal(readCounter(attempt), 3, 'exactly maxStartFailures spawn attempts should run')
    assert.equal(hp.child, undefined, 'no child should remain after giving up')
    // 再多等一段时间，确认不再有新 spawn。
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 300))
    assert.equal(readCounter(attempt), 3, 'no further spawn attempts after giving up')
    assert.ok(
      entries.some((text) => String(text).includes('giving up')),
      `expected a "giving up" log, got: ${entries.join(' | ')}`,
    )
  } finally {
    hp.stop('test')
  }
})

test('bounded restart: READY resets the budget and a crash after READY keeps restarting', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-flaky-'))
  const attempt = join(dir, 'attempts')
  const { flaky } = writeFixtures(dir)
  const { logger } = captureLogger()
  const hp = new HelperProcess({
    command: process.execPath,
    args: [flaky],
    env: { ATTEMPT_FILE: attempt },
    headless: true,
    restartDelayMs: 30,
    maxStartFailures: 3,
  }, logger)
  try {
    // 前两次 READY 前失败（不达上限），第三次 READY——预算应清零。
    hp.start()
    await waitFor(() => hp.spawned === true)
    assert.equal(readCounter(attempt), 3, 'third attempt should reach READY')
    // 运行期崩溃（已 READY）不算失败预算：连续 kill 两次都应自动重启并再次 READY。
    for (let round = 0; round < 2; round += 1) {
      hp.child.kill('SIGKILL')
      await waitFor(() => hp.spawned === true && hp.child !== undefined)
      await waitFor(() => readCounter(attempt) === 4 + round)
    }
    assert.equal(readCounter(attempt), 5)
    assert.equal(hp.restartSuppressed, false, 'post-READY crashes must not exhaust the budget')
  } finally {
    hp.stop('test')
  }
})
