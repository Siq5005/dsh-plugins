import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createStealthAdapter,
  createHiddenNativeAdapter,
  autoCaptionImages,
  NATIVE_ROUTE,
} from '../src/adapter.js'
import { createImageMemory } from '../src/image-memory.js'

function makeCtx({ streamImpl } = {}) {
  const delegated = []
  const llm = {
    stream: streamImpl ?? (async function* (options) {
      delegated.push(options)
      yield { type: 'finish', reason: { kind: 'stop' } }
    }),
  }
  return { ctx: { llm, get: () => undefined, logger: { info: () => {}, warn: () => {} } }, delegated }
}

const imageBlock = (id) => ({
  type: 'image',
  attachment: { attachmentId: id, mediaType: 'image/png', bytes: 1, width: 1, height: 1 },
})

const nativeAdapter = {
  providerRetryPolicy: () => ({ attempts: 2 }),
  listModels: async () => [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }],
  resolveModel: async (_p, model) => ({ provider: 'native', id: model, name: model }),
}

test('stealth stream: 图片重写为文本并委托给 delegateProvider', async () => {
  const { ctx, delegated } = makeCtx()
  const imageMemory = createImageMemory(10)
  const adapter = createStealthAdapter(ctx, {
    delegateProvider: NATIVE_ROUTE,
    imageMemory,
    config: () => ({ autoCaption: false }),
    nativeAdapter: () => nativeAdapter,
  })
  const chunks = []
  for await (const chunk of adapter.stream({
    provider: 'deepseek-official',
    model: 'deepseek-chat',
    messages: [{ role: 'user', content: [imageBlock('sha256:a'), { type: 'text', text: '看图' }] }],
  })) {
    chunks.push(chunk)
  }
  assert.equal(delegated.length, 1)
  const sent = delegated[0]
  assert.equal(sent.provider, NATIVE_ROUTE)
  assert.equal(sent.model, 'deepseek-chat')
  const content = sent.messages[0].content
  assert.equal(content[0].type, 'text') // 图片已被替换为文本
  assert.match(content[0].text, /sha256:a/)
  assert.match(content[0].text, /analyze_image/)
  assert.equal(content[1].text, '看图')
  assert.equal(chunks[0].type, 'finish')
})

test('stealth stream: 有缓存描述时直接内嵌', async () => {
  const { ctx, delegated } = makeCtx()
  const imageMemory = createImageMemory(10)
  imageMemory.set('sha256:a', '缓存描述内容')
  const adapter = createStealthAdapter(ctx, {
    delegateProvider: NATIVE_ROUTE,
    imageMemory,
    config: () => ({ autoCaption: false }),
    nativeAdapter: () => nativeAdapter,
  })
  for await (const _ of adapter.stream({
    provider: 'deepseek-official',
    model: 'm',
    messages: [{ role: 'user', content: [imageBlock('sha256:a')] }],
  })) { /* consume */ }
  const content = delegated[0].messages[0].content
  assert.match(content[0].text, /缓存描述内容/)
  assert.doesNotMatch(content[0].text, /analyze_image/)
})

test('stealth stream: 纯文本消息原样委托', async () => {
  const { ctx, delegated } = makeCtx()
  const adapter = createStealthAdapter(ctx, {
    delegateProvider: NATIVE_ROUTE,
    imageMemory: createImageMemory(10),
    config: () => ({ autoCaption: false }),
    nativeAdapter: () => nativeAdapter,
  })
  for await (const _ of adapter.stream({
    provider: 'deepseek-official',
    model: 'm',
    messages: [{ role: 'user', content: [{ type: 'text', text: '你好' }] }],
  })) { /* consume */ }
  const sent = delegated[0]
  assert.equal(sent.provider, NATIVE_ROUTE)
  assert.equal(sent.messages[0].content[0].text, '你好')
})

test('stealth adapter: listModels / resolveModel 声明 image 输入', async () => {
  const { ctx } = makeCtx()
  const adapter = createStealthAdapter(ctx, {
    delegateProvider: NATIVE_ROUTE,
    imageMemory: createImageMemory(10),
    config: () => ({ autoCaption: false }),
    nativeAdapter: () => nativeAdapter,
  })
  const models = await adapter.listModels('deepseek-official')
  assert.deepEqual(models[0].inputModalities, ['text', 'image'])
  const resolved = await adapter.resolveModel('deepseek-official', 'deepseek-chat')
  assert.deepEqual(resolved.inputModalities, ['text', 'image'])
  assert.equal(resolved.id, 'deepseek-chat')
})

test('stealth adapter: providerInfo 显示名可配置（默认 DeepSeek）', () => {
  const { ctx } = makeCtx()
  const base = createStealthAdapter(ctx, {
    delegateProvider: NATIVE_ROUTE,
    imageMemory: createImageMemory(10),
    config: () => ({ autoCaption: false }),
    nativeAdapter: () => nativeAdapter,
  })
  assert.equal(base.providerInfo('deepseek-official').name, 'DeepSeek')
  const vision = createStealthAdapter(ctx, {
    delegateProvider: NATIVE_ROUTE,
    imageMemory: createImageMemory(10),
    config: () => ({ autoCaption: false }),
    nativeAdapter: () => nativeAdapter,
    displayName: 'DeepSeek (vision)',
  })
  assert.equal(vision.providerInfo('deepseek-vision').name, 'DeepSeek (vision)')
})

// 0.1.2-rc.1 起 LlmRuntime 无条件调用 registration.adapter.prepareCall()。
// 对象字面量 adapter 必须自带 prepareCall，否则报
// "registration.adapter.prepareCall is not a function"。
test('stealth adapter: prepareCall 存在并解析 model（含 image 输入）', async () => {
  const { ctx } = makeCtx()
  const adapter = createStealthAdapter(ctx, {
    delegateProvider: NATIVE_ROUTE,
    imageMemory: createImageMemory(10),
    config: () => ({ autoCaption: false }),
    nativeAdapter: () => nativeAdapter,
  })
  const prepared = await adapter.prepareCall('deepseek-official', 'deepseek-chat')
  assert.equal(prepared.model.id, 'deepseek-chat')
  assert.deepEqual(prepared.model.inputModalities, ['text', 'image'])
  assert.equal(typeof prepared.stream, 'function')
  // prepared.stream 走同一改写委托链路
  const delegated = []
  const llm = {
    stream: async function* (options) {
      delegated.push(options)
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  const streamAdapter = createStealthAdapter(
    { llm, get: () => undefined },
    {
      delegateProvider: NATIVE_ROUTE,
      imageMemory: createImageMemory(10),
      config: () => ({ autoCaption: false }),
      nativeAdapter: () => nativeAdapter,
    },
  )
  const prepared2 = await streamAdapter.prepareCall('deepseek-official', 'deepseek-chat')
  for await (const _ of prepared2.stream({
    provider: 'deepseek-official',
    model: 'deepseek-chat',
    messages: [{ role: 'user', content: [imageBlock('sha256:a'), { type: 'text', text: '看图' }] }],
  })) { /* consume */ }
  assert.equal(delegated.length, 1)
  assert.equal(delegated[0].provider, NATIVE_ROUTE)
  assert.equal(delegated[0].messages[0].content[0].type, 'text')
})

test('hidden native adapter: prepareCall 委托原生 resolveModel/stream', async () => {
  const adapter = createHiddenNativeAdapter({
    ...nativeAdapter,
    stream: async function* () {
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  })
  const prepared = await adapter.prepareCall(NATIVE_ROUTE, 'deepseek-chat')
  assert.equal(prepared.model.id, 'deepseek-chat')
  assert.equal(typeof prepared.stream, 'function')
})

test('stealth / hidden adapter: 兼容 rc1 LlmAdapter 默认方法面（imageRequestPricing 等）', () => {
  const { ctx } = makeCtx()
  const stealth = createStealthAdapter(ctx, {
    delegateProvider: NATIVE_ROUTE,
    imageMemory: createImageMemory(10),
    config: () => ({ autoCaption: false }),
    nativeAdapter: () => nativeAdapter,
  })
  const hidden = createHiddenNativeAdapter(nativeAdapter)
  for (const adapter of [stealth, hidden]) {
    assert.equal(typeof adapter.prepareCall, 'function')
    assert.equal(typeof adapter.imageRequestPricing, 'function')
    assert.equal(typeof adapter.providerRetryPolicy, 'function')
  }
})

test('autoCaptionImages: 开启时自动描述并写入缓存', async () => {
  const stored = new Map([['sha256:a', { data: Buffer.from([1]), mediaType: 'image/png' }]])
  const attachments = {
    readImage: async (ref) => ({ data: stored.get(ref.attachmentId).data, ref: { ...ref, mediaType: 'image/png' } }),
  }
  const calls = []
  const imageMemory = createImageMemory(10)
  const messages = [{ role: 'user', content: [imageBlock('sha256:a')] }]
  await autoCaptionImages(messages, {
    config: () => ({ autoCaption: true, baseURL: 'https://x/v1', apiKey: 'k', model: 'm', captionPrompt: '', timeoutMs: 1000 }),
    imageMemory,
    attachments: () => attachments,
    callVision: async (input) => {
      calls.push(input)
      return { ok: true, text: '自动生成的描述' }
    },
  })
  assert.equal(calls.length, 1)
  assert.equal(imageMemory.get('sha256:a'), '自动生成的描述')
})

test('autoCaptionImages: 关闭时不调用视觉', async () => {
  const calls = []
  const imageMemory = createImageMemory(10)
  await autoCaptionImages([{ role: 'user', content: [imageBlock('sha256:a')] }], {
    config: () => ({ autoCaption: false }),
    imageMemory,
    callVision: async () => { calls.push(1); return { ok: true, text: 'x' } },
  })
  assert.equal(calls.length, 0)
  assert.equal(imageMemory.get('sha256:a'), undefined)
})

test('autoCaptionImages: 已有缓存描述时跳过', async () => {
  const calls = []
  const imageMemory = createImageMemory(10)
  imageMemory.set('sha256:a', '已有')
  await autoCaptionImages([{ role: 'user', content: [imageBlock('sha256:a')] }], {
    config: () => ({ autoCaption: true, baseURL: 'x', apiKey: 'k', model: 'm' }),
    imageMemory,
    attachments: () => ({ readImage: async () => ({ data: Buffer.from([1]), ref: { mediaType: 'image/png' } }) }),
    callVision: async () => { calls.push(1); return { ok: true, text: 'x' } },
  })
  assert.equal(calls.length, 0)
})
