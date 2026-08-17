import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, Config } from '../src/index.js'

function makeCtx() {
  const registeredTools = []
  const registeredRoutes = []
  const providers = new Map() // route -> adapter（模拟已注册 adapter）
  const ctx = {
    logger: { info: () => {}, warn: () => {} },
    get: (key) => {
      if (key === 'settings') return { get: () => ({}) }
      if (key === 'credentials') return undefined
      return undefined
    },
    effect: () => {},
    on: () => {},
    tools: {
      register: (def) => {
        registeredTools.push(def)
        return () => {}
      },
    },
    llm: {
      registerAdapter: (routes, adapter) => {
        for (const route of routes) providers.set(route, adapter)
        registeredRoutes.push(routes)
        return () => {
          for (const route of routes) providers.delete(route)
        }
      },
      registration: (route) => {
        if (!providers.has(route)) throw new Error(`NO_ADAPTER: ${route}`)
        return { adapter: providers.get(route) }
      },
      registerConfigurableProviders: () => {},
    },
  }
  return { ctx, registeredTools, registeredRoutes, providers }
}

test('Config schema 提供默认值', () => {
  const value = Config({})
  assert.equal(value.enabled, true)
  assert.equal(value.baseURL, 'https://api.openai.com/v1')
  assert.equal(value.model, 'gpt-4o-mini')
  assert.equal(value.autoCaption, false)
})

test('apply: 注册 analyze_image 工具 + 隐藏路由 + vision 包装组', async () => {
  const { ctx, registeredTools, providers } = makeCtx()
  apply(ctx, Config({}))
  // 工具注册
  assert.ok(registeredTools.some((def) => def.name === 'analyze_image'))
  // 隐藏原生路由 + deepseek-vision 包装组立即注册
  assert.ok(providers.has('deepseek-official-native'))
  assert.ok(providers.has('deepseek-vision'))
  // deepseek-official 尚未接管（settle 窗口内，官方行视为缺席则稍后接管）
  assert.ok(!providers.has('deepseek-official'))
  // 等待 settle 窗口结束，接管 deepseek-official
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 2200))
  assert.ok(providers.has('deepseek-official'))
  const stealth = providers.get('deepseek-official')
  const models = await stealth.listModels('deepseek-official')
  assert.ok(Array.isArray(models))
})

test('apply: 官方行在场时不接管，保留包装组', async () => {
  const { ctx, providers } = makeCtx()
  // 模拟官方 llm-deepseek 行已注册 deepseek-official
  providers.set('deepseek-official', { providerInfo: () => ({ id: 'deepseek-official', name: 'DeepSeek' }) })
  apply(ctx, Config({}))
  assert.ok(providers.has('deepseek-official-native'))
  assert.ok(providers.has('deepseek-vision'))
  // 接管尝试失败（DUPLICATE_ADAPTER），官方 adapter 原样保留
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 2200))
  assert.equal(providers.get('deepseek-official').providerInfo().name, 'DeepSeek')
})

test('apply: enabled=false 时完全不注册', () => {
  const { ctx, registeredTools, registeredRoutes } = makeCtx()
  apply(ctx, Config({ enabled: false }))
  assert.equal(registeredTools.length, 0)
  assert.equal(registeredRoutes.length, 0)
})
