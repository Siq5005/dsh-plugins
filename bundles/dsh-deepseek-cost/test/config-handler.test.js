import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import {
  CONFIG_ENDPOINT,
  configPayload,
  createConfigHandler,
  sanitizeConfigPatch,
} from '../src/index.js'
import { DEFAULT_PRICES } from '../src/pricing.js'

function memorySettings(initial = { enabled: true, models: [] }) {
  let value = JSON.parse(JSON.stringify(initial))
  return {
    get: () => ({ ...value, models: [...(value.models ?? [])] }),
    update: async (patch) => {
      value = { ...value, ...JSON.parse(JSON.stringify(patch)) }
    },
    watch: () => () => {},
  }
}

function mockResponse() {
  const res = {
    status: 0,
    body: null,
    writeHead(status, headers) { res.status = status; res.headers = headers },
    end(payload) { res.body = payload === undefined ? '' : String(payload) },
  }
  return res
}

function jsonBody(obj) {
  // 与真实 http.IncomingMessage 一致：chunk 为 Buffer。
  return Readable.from([Buffer.from(JSON.stringify(obj))])
}

function requestWith(method, { remoteAddress = '127.0.0.1', origin, host = '127.0.0.1:57969', body } = {}) {
  const stream = body ?? Readable.from([])
  const req = {
    method,
    socket: { remoteAddress },
    headers: { host, ...(origin !== undefined ? { origin } : {}) },
    // 与 node http.IncomingMessage 一致：请求体本身可异步迭代。
    [Symbol.asyncIterator]: () => stream[Symbol.asyncIterator](),
  }
  return req
}

test('sanitizeConfigPatch: 合法补丁清洗通过', () => {
  assert.deepEqual(sanitizeConfigPatch({ enabled: false }), { enabled: false })
  assert.deepEqual(sanitizeConfigPatch({
    models: [{ id: ' gpt-4o ', cacheMiss: 5, cacheHit: 0.5, output: 10 }],
  }), { models: [{ id: 'gpt-4o', cacheMiss: 5, cacheHit: 0.5, output: 10 }] })
  // name 可选；空 name 丢弃
  assert.deepEqual(sanitizeConfigPatch({
    models: [{ id: 'x', name: '   ', cacheMiss: 1, cacheHit: 0, output: 2 }],
  }), { models: [{ id: 'x', cacheMiss: 1, cacheHit: 0, output: 2 }] })
  // 空补丁合法（不更新任何字段）
  assert.deepEqual(sanitizeConfigPatch({}), {})
})

test('sanitizeConfigPatch: 非法补丁拒绝', () => {
  assert.throws(() => sanitizeConfigPatch(null), /patch must be an object/)
  assert.throws(() => sanitizeConfigPatch([1]), /patch must be an object/)
  assert.throws(() => sanitizeConfigPatch({ unknown: 1 }), /unknown setting/)
  assert.throws(() => sanitizeConfigPatch({ enabled: 'yes' }), /enabled must be a boolean/)
  assert.throws(() => sanitizeConfigPatch({ models: 'nope' }), /models must be an array/)
  assert.throws(() => sanitizeConfigPatch({ models: [{}] }), /\.id must be a non-empty string/)
  assert.throws(() => sanitizeConfigPatch({ models: [{ id: 'x', cacheMiss: -1, cacheHit: 0, output: 0 }] }), /cacheMiss must be a non-negative number/)
  assert.throws(() => sanitizeConfigPatch({ models: [{ id: 'x', cacheMiss: 1, cacheHit: 'a', output: 0 }] }), /cacheHit must be a non-negative number/)
})

test('configPayload: 返回设置 + 官方默认定价（只读）', () => {
  const settings = memorySettings({ enabled: true, models: [{ id: 'gpt-4o', cacheMiss: 5, cacheHit: 0.5, output: 10 }] })
  const payload = configPayload(settings)
  assert.equal(payload.enabled, true)
  assert.deepEqual(payload.models, [{ id: 'gpt-4o', cacheMiss: 5, cacheHit: 0.5, output: 10 }])
  assert.equal(payload.defaults, DEFAULT_PRICES) // 官方默认表直出
})

test('GET 返回当前配置（loopback 校验通过）', async () => {
  const settings = memorySettings()
  const handler = createConfigHandler(settings)
  const res = mockResponse()
  await handler(requestWith('GET'), res)
  assert.equal(res.status, 200)
  const payload = JSON.parse(res.body)
  assert.equal(payload.enabled, true)
  assert.deepEqual(payload.models, [])
  assert.ok(payload.defaults['deepseek-v4-flash'])
})

test('PATCH 更新设置并回读新配置', async () => {
  const settings = memorySettings()
  const handler = createConfigHandler(settings)
  const res = mockResponse()
  const req = requestWith('PATCH', { body: jsonBody({ models: [{ id: 'gpt-4o', cacheMiss: 5, cacheHit: 0.5, output: 10 }] }) })
  await handler(req, res)
  assert.equal(res.status, 200)
  const payload = JSON.parse(res.body)
  assert.equal(payload.models.length, 1)
  assert.equal(payload.models[0].id, 'gpt-4o')
})

test('PATCH 非法体返回 400', async () => {
  const handler = createConfigHandler(memorySettings())
  const res = mockResponse()
  const req = requestWith('PATCH', { body: jsonBody({ models: [{ id: '' }] }) })
  await handler(req, res)
  assert.equal(res.status, 400)
})

test('非 loopback 请求返回 403', async () => {
  const handler = createConfigHandler(memorySettings())
  const res = mockResponse()
  await handler(requestWith('GET', { remoteAddress: '192.168.1.10' }), res)
  assert.equal(res.status, 403)
})

test('origin 与 host 不匹配返回 403', async () => {
  const handler = createConfigHandler(memorySettings())
  const res = mockResponse()
  await handler(requestWith('GET', { origin: 'http://evil.example', host: '127.0.0.1:57969' }), res)
  assert.equal(res.status, 403)
})

test('非 GET/PATCH 方法返回 405', async () => {
  const handler = createConfigHandler(memorySettings())
  const res = mockResponse()
  await handler(requestWith('DELETE'), res)
  assert.equal(res.status, 405)
})

test('CONFIG_ENDPOINT 路径正确', () => {
  assert.equal(CONFIG_ENDPOINT, '/plugins/dsh-deepseek-cost/config')
})
