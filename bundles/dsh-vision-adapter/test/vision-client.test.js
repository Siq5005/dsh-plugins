import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  toDataUrl,
  classifyVisionError,
  buildVisionRequest,
  callVisionModel,
  extractAnswerText,
  endpointUrl,
} from '../src/vision-client.js'

test('toDataUrl: 生成 data URL', () => {
  const url = toDataUrl(Buffer.from([1, 2, 3]), 'image/png')
  assert.equal(url, 'data:image/png;base64,AQID')
})

test('endpointUrl: 拼接 /chat/completions 且容错', () => {
  assert.equal(endpointUrl('https://api.openai.com/v1'), 'https://api.openai.com/v1/chat/completions')
  assert.equal(endpointUrl('https://api.openai.com/v1/'), 'https://api.openai.com/v1/chat/completions')
  assert.equal(endpointUrl('https://www.yzcld.com'), 'https://www.yzcld.com/chat/completions')
  assert.equal(endpointUrl('https://x.com/chat/completions'), 'https://x.com/chat/completions')
  assert.equal(endpointUrl(''), '')
})

test('classifyVisionError: 各状态分类', () => {
  assert.equal(classifyVisionError(undefined, 401).kind, 'VISION_AUTH_FAILED')
  assert.equal(classifyVisionError(undefined, 401).retryable, false)
  assert.equal(classifyVisionError(undefined, 403).kind, 'VISION_AUTH_FAILED')
  assert.equal(classifyVisionError(undefined, 429).kind, 'VISION_RATE_LIMITED')
  assert.equal(classifyVisionError(undefined, 429).retryable, true)
  assert.equal(classifyVisionError(undefined, 408).kind, 'VISION_TIMEOUT')
  assert.equal(classifyVisionError(undefined, 500).kind, 'VISION_BACKEND_UNAVAILABLE')
  assert.equal(classifyVisionError(undefined, 502).retryable, true)
  assert.equal(classifyVisionError(undefined, 400).kind, 'VISION_OTHER')
  assert.equal(classifyVisionError(undefined, 400).retryable, false)
})

test('classifyVisionError: 网络错误与超时', () => {
  assert.equal(classifyVisionError(new Error('fetch failed'), undefined).kind, 'VISION_NETWORK')
  assert.equal(classifyVisionError(new Error('The operation timed out'), undefined).kind, 'VISION_TIMEOUT')
})

test('buildVisionRequest: OpenAI 兼容结构（system + image_url + text）', () => {
  const body = buildVisionRequest({
    model: 'gpt-4o-mini',
    question: '图里有什么？',
    images: [{ data: Buffer.from([1]), mediaType: 'image/png' }],
  })
  assert.equal(body.model, 'gpt-4o-mini')
  assert.equal(body.messages[0].role, 'system')
  assert.equal(body.messages[1].role, 'user')
  assert.equal(body.messages[1].content[0].type, 'image_url')
  assert.match(body.messages[1].content[0].image_url.url, /^data:image\/png;base64,/)
  assert.equal(body.messages[1].content[1].type, 'text')
  assert.equal(body.messages[1].content[1].text, '图里有什么？')
})

test('extractAnswerText: string / 数组 / 缺失', () => {
  assert.equal(extractAnswerText({ choices: [{ message: { content: '答案' } }] }), '答案')
  assert.equal(
    extractAnswerText({ choices: [{ message: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] } }] }),
    'ab',
  )
  assert.equal(extractAnswerText({ choices: [] }), undefined)
  assert.equal(extractAnswerText({}), undefined)
})

test('callVisionModel: 成功返回文本', async () => {
  const fetchImpl = async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/chat/completions')
    assert.equal(init.headers.authorization, 'Bearer sk-test')
    assert.match(init.body, /gpt-4o-mini/)
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '一只猫' } }] }) }
  }
  const result = await callVisionModel({
    baseURL: 'https://api.openai.com/v1/',
    apiKey: 'sk-test',
    model: 'gpt-4o-mini',
    question: '这是什么？',
    images: [{ data: Buffer.from([1, 2]), mediaType: 'image/png' }],
    fetchImpl,
  })
  assert.equal(result.ok, true)
  assert.equal(result.text, '一只猫')
})

test('callVisionModel: 401 认证失败不可重试（reason 带端点）', async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, text: async () => '{"error":{"message":"Invalid API key"}}' })
  const result = await callVisionModel({
    baseURL: 'https://x/v1', apiKey: 'bad', model: 'm',
    question: 'q', images: [{ data: Buffer.from([1]), mediaType: 'image/png' }],
    fetchImpl,
  })
  assert.equal(result.ok, false)
  assert.equal(result.kind, 'VISION_AUTH_FAILED')
  assert.equal(result.retryable, false)
  assert.match(result.reason, /端点：https:\/\/x\/v1\/chat\/completions/)
  assert.match(result.reason, /Invalid API key/)
})

test('callVisionModel: 非 JSON 响应（如打到网页）带端点与 body 片段', async () => {
  const fetchImpl = async () => ({
    ok: true, status: 200,
    json: async () => { throw new Error('not json') },
    text: async () => '<!doctype html><html>服务商前端页面</html>',
  })
  const result = await callVisionModel({
    baseURL: 'https://www.yzcld.com', apiKey: 'k', model: 'm',
    question: 'q', images: [{ data: Buffer.from([1]), mediaType: 'image/png' }],
    fetchImpl,
  })
  assert.equal(result.ok, false)
  assert.equal(result.kind, 'VISION_OTHER')
  assert.match(result.reason, /端点：https:\/\/www\.yzcld\.com\/chat\/completions/)
  assert.match(result.reason, /<!doctype html>/)
})

test('callVisionModel: 网络错误', async () => {
  const fetchImpl = async () => { throw new Error('fetch failed') }
  const result = await callVisionModel({
    baseURL: 'https://x/v1', apiKey: '', model: 'm',
    question: 'q', images: [{ data: Buffer.from([1]), mediaType: 'image/png' }],
    fetchImpl,
  })
  assert.equal(result.ok, false)
  assert.equal(result.kind, 'VISION_NETWORK')
  assert.equal(result.retryable, true)
  assert.match(result.reason, /端点：https:\/\/x\/v1\/chat\/completions/)
})

test('callVisionModel: baseURL 空 → 配置错误', async () => {
  const result = await callVisionModel({
    baseURL: '', apiKey: '', model: 'm',
    question: 'q', images: [{ data: Buffer.from([1]), mediaType: 'image/png' }],
  })
  assert.equal(result.ok, false)
  assert.match(result.reason, /baseURL/)
})

test('callVisionModel: 超时中止', async () => {
  const fetchImpl = async (_url, init) => {
    // 不响应，等 abort
    await new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('The operation timed out')))
    })
  }
  const result = await callVisionModel({
    baseURL: 'https://x/v1', apiKey: '', model: 'm', question: 'q',
    images: [{ data: Buffer.from([1]), mediaType: 'image/png' }],
    timeoutMs: 50, fetchImpl,
  })
  assert.equal(result.ok, false)
  assert.equal(result.kind, 'VISION_TIMEOUT')
})
