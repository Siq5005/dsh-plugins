import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, Config, name } from '../src/index.js'
import { createTokenCostProjection } from '../src/cost-projection.js'

function createMockCtx() {
  const registrations = []
  const routes = []
  const cleanups = []
  const settingsState = { enabled: true, models: [] }
  const settings = {
    register(ns, schema, opts) {
      assert.equal(ns, 'dsh-deepseek-cost')
      Object.assign(settingsState, opts?.base ?? {})
      return {
        get: () => ({ ...settingsState }),
        update: async (patch) => Object.assign(settingsState, patch),
        watch: () => () => {},
      }
    },
  }
  const ctx = {
    inject(deps, cb) {
      const services = {}
      if (deps.includes('sessionProjections')) {
        services.sessionProjections = {
          register(def) {
            registrations.push(def)
            return () => {
              const index = registrations.indexOf(def)
              if (index !== -1) registrations.splice(index, 1)
            }
          },
        }
      }
      if (deps.includes('settings')) {
        services.settings = settings
      }
      if (deps.includes('webServer')) {
        services.webServer = {
          register(route) { routes.push(route); return () => {} },
        }
      }
      services.effect = (fn) => {
        const cleanup = fn()
        if (typeof cleanup === 'function') cleanups.push(cleanup)
      }
      cb(services)
    },
  }
  return { ctx, registrations, routes, cleanups }
}

test('插件导出 name 与 Config', () => {
  assert.equal(name, 'dsh-deepseek-cost')
  assert.equal(typeof Config, 'function')
  // Config 可校验默认形态（无配置也可解析出 enabled 默认值）。
  const resolved = Config({})
  assert.equal(resolved.enabled, true)
})

test('apply 注册投影 + 设置命名空间 + 配置端点', () => {
  const { ctx, registrations, routes, cleanups } = createMockCtx()
  apply(ctx)
  // 投影
  assert.equal(registrations.length, 1)
  const definition = registrations[0]
  assert.equal(definition.key, 'tokenCost')
  assert.equal(definition.stateVersion, 2)
  assert.equal(typeof definition.init, 'function')
  assert.equal(typeof definition.apply, 'function')
  assert.equal(typeof definition.view, 'function')
  assert.equal(createTokenCostProjection().key, definition.key)
  // init 状态可解析 view 并过 schema。
  const value = definition.view(definition.init())
  assert.deepEqual(value, { models: [], lastTier: 'offpeak' })
  // 端点
  assert.equal(routes.length, 1)
  assert.equal(routes[0].path, '/plugins/dsh-deepseek-cost/config')
  assert.equal(routes[0].kind, 'exact')
  // 清理：disposer 从注册表移除。
  assert.ok(cleanups.length >= 1)
  cleanups[0]()
  assert.equal(registrations.length, 0)
})

test('apply 传 enabled:false 不注册任何能力', () => {
  const { ctx, registrations, routes } = createMockCtx()
  apply(ctx, { enabled: false })
  assert.equal(registrations.length, 0)
  assert.equal(routes.length, 0)
})

test('apply 在无 inject 的上下文上不抛错', () => {
  apply({})
  apply({ inject: undefined })
})

test('apply 在注入回调缺服务时不抛错（headless 组装）', () => {
  const ctx = {
    inject(deps, cb) {
      cb({ effect: () => () => {} })
    },
  }
  apply(ctx)
})
