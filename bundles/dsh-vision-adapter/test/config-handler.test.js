import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, sanitizeConfigPatch, configPayload, createConfigHandler } from '../src/index.js'

test('sanitizeConfigPatch: 白名单过滤未知字段', () => {
  assert.deepEqual(sanitizeConfigPatch({ model: 'gpt-4o-mini', hack: 'x', autoCaption: true }), {
    model: 'gpt-4o-mini',
    autoCaption: true,
  })
  assert.deepEqual(sanitizeConfigPatch({ undefined: 'x' }), {})
  assert.deepEqual(sanitizeConfigPatch(null), {})
  assert.deepEqual(sanitizeConfigPatch('nope'), {})
})

test('configPayload: 返回完整公开设置', () => {
  const settings = { get: () => ({ enabled: true, baseURL: 'https://x/v1', apiKey: '' }) }
  assert.deepEqual(configPayload(settings), { enabled: true, baseURL: 'https://x/v1', apiKey: '' })
})

function makeReqRes({ method = 'GET', remoteAddress = '127.0.0.1', headers = {}, body } = {}) {
  const req = {
    method,
    socket: { remoteAddress },
    headers,
    [Symbol.asyncIterator]: async function* () {
      if (body !== undefined) yield Buffer.from(body)
    },
  }
  const res = {
    statusCode: 0,
    setHeader() {},
    end(payload) { res.body = payload },
  }
  return { req, res }
}

test('config handler: GET 返回设置', async () => {
  const settings = { get: () => ({ model: 'm' }), update: async () => {} }
  const { req, res } = makeReqRes({ method: 'GET' })
  await createConfigHandler(settings)(req, res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(JSON.parse(res.body), { model: 'm' })
})

test('config handler: PATCH 白名单更新并返回新设置', async () => {
  let stored = { model: 'old', apiKey: '' }
  const settings = {
    get: () => stored,
    update: async (patch) => { stored = { ...stored, ...patch } },
  }
  const { req, res } = makeReqRes({
    method: 'PATCH',
    body: JSON.stringify({ model: 'new-model', evil: 'x' }),
  })
  await createConfigHandler(settings)(req, res)
  assert.equal(res.statusCode, 200)
  const payload = JSON.parse(res.body)
  assert.equal(payload.model, 'new-model')
  assert.equal(payload.evil, undefined)
})

test('config handler: 非回环地址 403', async () => {
  const { req, res } = makeReqRes({ remoteAddress: '203.0.113.9' })
  await createConfigHandler({ get: () => ({}), update: async () => {} })(req, res)
  assert.equal(res.statusCode, 403)
})

test('config handler: 非法 JSON → 400', async () => {
  const { req, res } = makeReqRes({ method: 'PATCH', body: 'not-json' })
  await createConfigHandler({ get: () => ({}), update: async () => {} })(req, res)
  assert.equal(res.statusCode, 400)
})

test('apply: 有 settings/webServer 服务时注册命名空间与端点（live 生效）', async () => {
  let registeredSettings
  const endpoints = []
  const ctx = {
    logger: { info: () => {}, warn: () => {} },
    get: () => undefined,
    effect: () => {},
    on: () => {},
    tools: { register: () => () => {} },
    llm: {
      registerAdapter: () => () => {},
      registration: () => { throw new Error('NO_ADAPTER') },
      registerConfigurableProviders: () => {},
    },
    inject: (keys, fn) => {
      if (keys.includes('settings')) {
        const settingsCtx = {
          settings: {
            register: (ns, schema, opts) => {
              registeredSettings = { ns, schema, opts }
              return {
                get: () => ({ enabled: true, model: 'from-settings' }),
                update: async () => {},
              }
            },
          },
        }
        fn(settingsCtx)
        if (keys.length === 1) return
        // 嵌套 webServer 注入由注册回调内自行发起
      }
      if (keys.includes('webServer')) {
        const httpCtx = {
          effect: (fn) => { fn(); return () => {} },
          webServer: {
            register: (entry) => { endpoints.push(entry) },
          },
        }
        fn(httpCtx)
      }
    },
  }
  apply(ctx, { enabled: true, model: 'from-patch' })
  assert.ok(registeredSettings)
  assert.equal(registeredSettings.ns, 'dsh-vision-adapter')
  assert.equal(registeredSettings.opts.applies, 'live')
  assert.equal(endpoints.length, 1)
  assert.equal(endpoints[0].path, '/plugins/dsh-vision-adapter/config')
})
