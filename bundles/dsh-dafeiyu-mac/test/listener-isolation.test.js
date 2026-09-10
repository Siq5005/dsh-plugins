// D-020 A7a：宿主总线监听故障隔离——单个坏事件不得抛进共享总线、连坐其它订阅者
// （对照上游 0.1.0-alpha.15）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/index.js'

// 假 helper：READY 后把 stdin 收到的消息原样落到 EVENT_LOG，用于确认正常链路未被破坏。
function writeHelperFixture(dir) {
  const script = join(dir, 'ready-helper.cjs')
  writeFileSync(script, `
const fs = require('node:fs')
process.stdout.write(JSON.stringify({ protocolVersion: 1, kind: 'ready' }) + '\\n')
process.stdin.resume()
process.stdin.on('data', (chunk) => fs.appendFileSync(process.env.EVENT_LOG, chunk))
process.stdin.on('end', () => process.exit(0))
`.trimStart())
  return script
}

function createCtx() {
  const listeners = { event: [], disposed: [] }
  const cleanups = []
  const logs = { warn: [], error: [] }
  const state = {}
  const logger = {
    info() {},
    warn: (message) => logs.warn.push(String(message)),
    error: (message) => logs.error.push(String(message)),
    debug() {},
  }
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
    on(type, handler) {
      if (type === 'session/event') listeners.event.push(handler)
      if (type === 'session/disposed') listeners.disposed.push(handler)
      return () => {}
    },
    inject,
    effect: (fn) => { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
  }
  return { ctx, listeners, cleanups, logs }
}

// 读属性即抛的恶意对象：模拟 DSH 传来的坏事件数据。
function poisoned() {
  return new Proxy({}, {
    get() { throw new Error('poisoned event payload') },
  })
}

function readLog(path) {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
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

test('host bus: a poisoned session/event must not escape the listener and normal events still flow', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-isolation-'))
  const logPath = join(dir, 'events.jsonl')
  const script = writeHelperFixture(dir)
  const { ctx, listeners, cleanups, logs } = createCtx()
  try {
    apply(ctx, {
      enabled: true,
      helper: { command: process.execPath, args: [script], env: { EVENT_LOG: logPath }, headless: true },
    })
    assert.equal(listeners.event.length, 1, 'session/event 监听应已注册')

    const session = { header: { id: 's1', cwd: '/work/demo' } }
    // 坏事件：reducer 一旦读取 data 属性就会抛错。
    assert.doesNotThrow(
      () => listeners.event.forEach((handler) => handler(session, { type: 'tool/call', seq: 1, data: poisoned() })),
      '坏事件不得从监听器抛出',
    )
    assert.ok(
      logs.warn.some((text) => text.includes('isolated')),
      `应记录隔离告警，实际：${logs.warn.join(' | ')}`,
    )

    // 正常事件仍能推进状态：tool/call -> WORKING 应送达 helper。
    listeners.event.forEach((handler) => handler(session, {
      type: 'tool/call', seq: 2,
      data: { name: 'bash', message: { source: { callId: 'c1' } } },
    }))
    await waitFor(() => readLog(logPath).some((m) => m.kind === 'state' && m.state === 'WORKING'))
  } finally {
    for (const cleanup of cleanups) cleanup()
  }
})

test('host bus: a poisoned session/disposed must not escape the listener', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-isolation-'))
  const logPath = join(dir, 'events.jsonl')
  const script = writeHelperFixture(dir)
  const { ctx, listeners, cleanups, logs } = createCtx()
  try {
    apply(ctx, {
      enabled: true,
      helper: { command: process.execPath, args: [script], env: { EVENT_LOG: logPath }, headless: true },
    })
    assert.equal(listeners.disposed.length, 1, 'session/disposed 监听应已注册')
    assert.doesNotThrow(
      () => listeners.disposed.forEach((handler) => handler({ header: poisoned() })),
      '坏 session 不得从监听器抛出',
    )
    assert.ok(
      logs.warn.some((text) => text.includes('isolated')),
      `应记录隔离告警，实际：${logs.warn.join(' | ')}`,
    )
  } finally {
    for (const cleanup of cleanups) cleanup()
  }
})
