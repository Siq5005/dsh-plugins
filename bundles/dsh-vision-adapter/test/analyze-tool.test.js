import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAnalyzeImageTool } from '../src/analyze-tool.js'
import { createImageMemory, createAnswerCache } from '../src/image-memory.js'

const REF_A = { attachmentId: 'sha256:a', mediaType: 'image/png', bytes: 1, width: 1, height: 1 }
const REF_B = { attachmentId: 'sha256:b', mediaType: 'image/jpeg', bytes: 2, width: 1, height: 1 }

function makeHarness({ visionImpl } = {}) {
  const stored = new Map([
    ['sha256:a', { data: Buffer.from([1, 2]), mediaType: 'image/png' }],
    ['sha256:b', { data: Buffer.from([3, 4, 5]), mediaType: 'image/jpeg' }],
  ])
  const attachments = {
    readImage: async (ref, _signal) => {
      const entry = stored.get(ref.attachmentId)
      if (entry === undefined) throw new Error('not found')
      return { data: entry.data, ref: { ...ref, mediaType: entry.mediaType } }
    },
  }
  const ctx = { get: (key) => (key === 'attachments' ? attachments : undefined) }
  const config = () => ({
    enabled: true,
    baseURL: 'https://vision.test/v1',
    apiKey: 'sk-test',
    model: 'gpt-4o-mini',
    captionPrompt: '',
    timeoutMs: 5000,
  })
  const imageMemory = createImageMemory(10)
  const answerCache = createAnswerCache(10, 0)
  const calls = []
  const callVision = async (input) => {
    calls.push(input)
    return visionImpl === undefined ? { ok: true, text: '一只猫' } : visionImpl(input)
  }
  const tool = createAnalyzeImageTool(ctx, { config, imageMemory, answerCache, callVision })
  const events = [
    {
      type: 'user/message', seq: 1,
      data: {
        role: 'user',
        content: [
          { type: 'text', text: '看这张' },
          { type: 'image', attachment: REF_A },
          { type: 'image', attachment: REF_B },
        ],
        source: { kind: 'user' },
      },
    },
  ]
  const exec = {
    signal: new AbortController().signal,
    agent: { session: { events } },
  }
  return { tool, exec, calls, imageMemory, answerCache }
}

test('analyze_image: 成功返回文字并写入缓存与描述记忆', async () => {
  const h = makeHarness()
  const result = await h.tool.execute({ attachmentIds: ['sha256:a'], question: '这是什么？' }, h.exec)
  assert.equal(result, '一只猫')
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].model, 'gpt-4o-mini')
  assert.equal(h.calls[0].images.length, 1)
  // 描述记忆写入 → 后续请求重写时直接内嵌描述
  assert.equal(h.imageMemory.get('sha256:a'), '一只猫')
})

test('analyze_image: 相同内容+问题命中缓存，不再调视觉', async () => {
  const h = makeHarness()
  const first = await h.tool.execute({ attachmentIds: ['sha256:a'], question: 'Q' }, h.exec)
  const second = await h.tool.execute({ attachmentIds: ['sha256:a'], question: 'Q' }, h.exec)
  assert.equal(first, '一只猫')
  assert.equal(second, '一只猫')
  assert.equal(h.calls.length, 1)
})

test('analyze_image: 问题不同不命中缓存', async () => {
  const h = makeHarness()
  await h.tool.execute({ attachmentIds: ['sha256:a'], question: 'Q1' }, h.exec)
  await h.tool.execute({ attachmentIds: ['sha256:a'], question: 'Q2' }, h.exec)
  assert.equal(h.calls.length, 2)
})

test('analyze_image: 多图一起分析', async () => {
  const h = makeHarness()
  const result = await h.tool.execute({ attachmentIds: ['sha256:a', 'sha256:b'], question: '对比两张图' }, h.exec)
  assert.equal(result, '一只猫')
  assert.equal(h.calls[0].images.length, 2)
})

test('analyze_image: 未知附件 id → ok:false，不调视觉', async () => {
  const h = makeHarness()
  const result = JSON.parse(await h.tool.execute({ attachmentIds: ['sha256:nope'], question: 'Q' }, h.exec))
  assert.equal(result.ok, false)
  assert.equal(result.code, 'VISION_UNKNOWN_ATTACHMENT')
  assert.equal(h.calls.length, 0)
})

test('analyze_image: 视觉失败 → 结构化 ok:false 保留 retryable', async () => {
  const h = makeHarness({
    visionImpl: async () => ({ ok: false, kind: 'VISION_RATE_LIMITED', retryable: true, reason: '限流' }),
  })
  const result = JSON.parse(await h.tool.execute({ attachmentIds: ['sha256:a'], question: 'Q' }, h.exec))
  assert.equal(result.ok, false)
  assert.equal(result.code, 'VISION_RATE_LIMITED')
  assert.equal(result.retryable, true)
  // 失败不写缓存与描述记忆
  assert.equal(h.imageMemory.get('sha256:a'), undefined)
})

test('analyze_image: 参数校验', async () => {
  const h = makeHarness()
  await assert.rejects(() => h.tool.execute({ attachmentIds: [], question: 'Q' }, h.exec))
  await assert.rejects(() => h.tool.execute({ attachmentIds: ['sha256:a'], question: '' }, h.exec))
  await assert.rejects(() => h.tool.execute({ attachmentIds: ['x', 'y', 'z', 'w', 'v'], question: 'Q' }, h.exec))
})
