import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, Config, name } from '../src/index.js'
import { createTokenCostProjection } from '../src/cost-projection.js'

function createMockCtx() {
  const registrations = []
  const cleanups = []
  const ctx = {
    // 与真实 DSH 一致：inject 等待服务后调用回调；effect 立即执行并收集 cleanup。
    inject(deps, cb) {
      cb({
        sessionProjections: {
          register(def) {
            registrations.push(def)
            // 与真实 sessionProjections.register 一致：返回精确 disposer；
            // 清理由外层 effect(fn) 统一登记。
            return () => {
              const index = registrations.indexOf(def)
              if (index !== -1) registrations.splice(index, 1)
            }
          },
        },
        effect(fn) {
          const cleanup = fn()
          if (typeof cleanup === 'function') cleanups.push(cleanup)
        },
      })
    },
  }
  return { ctx, registrations, cleanups }
}

test('插件导出 name 与 Config', () => {
  assert.equal(name, 'dsh-deepseek-cost')
  assert.equal(typeof Config, 'function')
  // Config 可校验默认形态（无配置也可解析出 enabled 默认值）。
  const resolved = Config({})
  assert.equal(resolved.enabled, true)
})

test('apply 注册 tokenCost 投影，定义可通过校验', () => {
  const { ctx, registrations, cleanups } = createMockCtx()
  apply(ctx)
  assert.equal(registrations.length, 1)
  const definition = registrations[0]
  assert.equal(definition.key, 'tokenCost')
  assert.equal(definition.stateVersion, 1)
  assert.equal(typeof definition.init, 'function')
  assert.equal(typeof definition.apply, 'function')
  assert.equal(typeof definition.view, 'function')
  // 定义与导出的工厂一致（同一实现）。
  const direct = createTokenCostProjection()
  assert.equal(direct.key, definition.key)
  // init 状态可解析 view 并过 schema。
  const value = definition.view(definition.init())
  assert.equal(value.totalCostCny, 0)
  // 清理：disposer 从注册表移除。
  assert.equal(cleanups.length, 1)
  cleanups[0]()
  assert.equal(registrations.length, 0)
})

test('apply 传 enabled:false 不注册', () => {
  const { ctx, registrations } = createMockCtx()
  apply(ctx, { enabled: false })
  assert.equal(registrations.length, 0)
})

test('apply 在无 inject 的上下文上不抛错', () => {
  apply({})
  apply({ inject: undefined })
})

test('apply 在无 sessionProjections 的注入回调上不抛错（headless 组装）', () => {
  const ctx = {
    inject(deps, cb) {
      cb({ effect: () => () => {} })
    },
  }
  apply(ctx)
})
