import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/index.js'

// 让 helper 以 headless 模式运行，并把收到的消息记录到临时 event log。
process.env.DSH_DAFEIYU_HEADLESS = '1'
const eventLog = join(mkdtempSync(join(tmpdir(), 'dsh-pet-smoke-')), 'events.jsonl')
process.env.DSH_DAFEIYU_EVENT_LOG = eventLog

function readLog() {
  if (!existsSync(eventLog)) return []
  return readFileSync(eventLog, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
}

function waitFor(predicate, timeoutMs = 8000) {
  const started = Date.now()
  return new Promise((resolvePromise, reject) => {
    const check = () => {
      if (predicate()) return resolvePromise()
      if (Date.now() - started > timeoutMs) return reject(new Error('timed out waiting for condition'))
      setTimeout(check, 25)
    }
    check()
  })
}

function createMockCtx() {
  const listeners = { event: [], disposed: [] }
  const state = {}
  let watcher
  const cleanups = []
  const settings = {
    register(name, schema, opts) {
      Object.assign(state, opts?.base ?? {})
      return {
        get: () => ({ ...state }),
        update: async (patch) => { Object.assign(state, patch) },
        watch: (cb) => { watcher = cb; return () => { watcher = undefined } },
      }
    },
  }
  const ctx = {
    logger: console,
    settings,
    on(type, handler) {
      if (type === 'session/event') listeners.event.push(handler)
      if (type === 'session/disposed') listeners.disposed.push(handler)
      return () => {}
    },
    // 与真实 DSH 一致：effect(fn) 立即执行 fn()，保存返回的 cleanup。
    inject(deps, cb) {
      cb({
        settings,
        webServer: { register: () => () => {} },
        effect: (fn) => { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
      })
    },
    effect(fn) { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
  }
  return { ctx, listeners, cleanups, getWatcher: () => watcher }
}

test('plugin mounts, session events drive states, cleanup stops the helper', async () => {
  const { ctx, listeners, cleanups } = createMockCtx()
  apply(ctx)
  try {
    // 1) helper 启动并收到初始 hello + IDLE state。
    await waitFor(() => readLog().some((m) => m.kind === 'hello'))
    await waitFor(() => readLog().some((m) => m.kind === 'state' && m.state === 'IDLE'))
    const first = readLog()[0]
    assert.equal(first.kind, 'hello')

    // 2) 模拟 DSH 会话事件：turn/start -> THINKING，tool/call -> WORKING。
    const session = { header: { id: 's1', cwd: '/work/demo' } }
    listeners.event.forEach((handler) => handler(session, { type: 'turn/start', seq: 1 }))
    await waitFor(() => readLog().some((m) => m.kind === 'state' && m.state === 'THINKING'))
    listeners.event.forEach((handler) => handler(session, {
      type: 'tool/call', seq: 2,
      data: { name: 'bash', message: { source: { callId: 'c1' } } },
    }))
    await waitFor(() => readLog().some((m) => m.kind === 'state' && m.state === 'WORKING'))

    // 3) 清理：执行所有 cleanup（含 bridge.stop -> SHUTDOWN 消息）。
    for (const cleanup of cleanups) cleanup()
    await waitFor(() => readLog().some((m) => m.kind === 'shutdown'))
    const last = readLog().at(-1)
    assert.equal(last.kind, 'shutdown')
  } finally {
    // 兜底：确保 helper 进程被终止，避免测试残留。
    for (const cleanup of cleanups) cleanup()
  }
})
