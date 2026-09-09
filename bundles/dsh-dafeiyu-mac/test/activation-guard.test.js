// D-020 A1：激活护栏——激活期/设置回调抛错不得拖垮 DSH boot（对照上游 0.1.7 #62 / 0.1.8 #65）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../src/index.js'

// 任何意外触发的 helper 都以 headless 协议模式运行，绝不弹出桌面窗口。
process.env.DSH_DAFEIYU_HEADLESS = '1'

function createSilentLogger() {
  const logs = { info: [], warn: [], error: [], debug: [] }
  return {
    logger: {
      info: (message) => logs.info.push(message),
      warn: (message) => logs.warn.push(message),
      error: (message) => logs.error.push(message),
      debug: (message) => logs.debug.push(message),
    },
    logs,
  }
}

// 可注入故障的 mock ctx：settings.register / webServer.register 抛错时模拟宿主 API 变化。
function createCtx({ registerThrows = false, webServerThrows = false } = {}) {
  const { logger, logs } = createSilentLogger()
  const listeners = { event: [], disposed: [] }
  const cleanups = []
  const state = {}
  let watcher

  // 与真实 DSH 一致：inject 出的子 ctx 自带 logger，且自身也可再 inject
  // （mount 会在 apply 注入的 settings 子 ctx 上再取 webServer）。
  const inject = (deps, cb) => {
    cb({
      logger,
      settings,
      webServer: {
        register() {
          if (webServerThrows) throw new Error('webServer.register boom')
          return () => {}
        },
      },
      effect: (fn) => { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
      inject,
    })
  }

  const settings = {
    register(name, schema, opts) {
      if (registerThrows) throw new Error('settings.register boom')
      Object.assign(state, opts?.base ?? {})
      return {
        get: () => ({ ...state }),
        update: async (patch) => { Object.assign(state, patch) },
        watch: (cb) => { watcher = cb; return () => { watcher = undefined } },
      }
    },
  }

  const ctx = {
    logger,
    settings,
    on(type, handler) {
      if (type === 'session/event') listeners.event.push(handler)
      if (type === 'session/disposed') listeners.disposed.push(handler)
      return () => {}
    },
    inject,
    effect(fn) { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
  }
  return { ctx, listeners, cleanups, getWatcher: () => watcher, logs }
}

test('activation: settings.register throw must not escape apply and logs failed to activate', () => {
  const { ctx, logs, listeners, cleanups } = createCtx({ registerThrows: true })
  assert.doesNotThrow(() => apply(ctx, { enabled: false }))
  assert.ok(
    logs.error.some((text) => String(text).includes('failed to activate')),
    `expected a "failed to activate" log, got: ${logs.error.join(' | ')}`,
  )
  // 激活失败后保持惰性：不挂事件监听、不注册清理。
  assert.equal(listeners.event.length, 0)
  assert.equal(listeners.disposed.length, 0)
  assert.equal(cleanups.length, 0)
})

test('activation: webServer.register throw during activation must not escape apply and logs failed to activate', () => {
  const { ctx, logs } = createCtx({ webServerThrows: true })
  assert.doesNotThrow(() => apply(ctx, { enabled: false }))
  assert.ok(
    logs.error.some((text) => String(text).includes('failed to activate')),
    `expected a "failed to activate" log, got: ${logs.error.join(' | ')}`,
  )
})

test('activation: settings.watch callback runs without throwing (regression: watch guard keeps normal flow alive)', () => {
  const { ctx, getWatcher, cleanups } = createCtx()
  try {
    apply(ctx, { enabled: false })
    const watcher = getWatcher()
    assert.equal(typeof watcher, 'function', 'settings.watch callback should be registered on successful activation')
    // 正常设置流（关闭→尝试开启→关闭）不得抛错，也不得产生 error 日志。
    const full = { enabled: false, scale: 1, bubbleScale: 1, activityLevel: 'normal', reducedMotion: false, includeSubagents: false, locked: false }
    assert.doesNotThrow(() => watcher(full))
    assert.doesNotThrow(() => watcher({ ...full, enabled: true }))
    assert.doesNotThrow(() => watcher({ ...full, enabled: false }))
  } finally {
    // 清理挂起的重启定时器与运行时，避免测试残留。
    for (const cleanup of cleanups) cleanup()
  }
})
