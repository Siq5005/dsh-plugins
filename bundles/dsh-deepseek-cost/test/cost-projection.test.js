import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTokenCostProjection, tokenCostSchema } from '../src/cost-projection.js'

// 北京时间某时刻（北京 = UTC+8）。
function beijingTime(hour, minute = 0) {
  return Date.UTC(2026, 0, 1, hour - 8, minute)
}

let seq = 0
function assistantMessage({ turn, step, model, usage, time = beijingTime(10) }) {
  seq += 1
  return {
    type: 'assistant/message',
    seq,
    time,
    data: {
      turn,
      step,
      message: {
        role: 'assistant',
        content: [],
        source: { kind: 'model', provider: 'deepseek-official', model },
      },
      usage,
    },
  }
}

const emptyBucket = { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }

test('init 状态为纯 JSON，空日志 view 全零', () => {
  const projection = createTokenCostProjection()
  const state = projection.init()
  assert.deepEqual(state, { perModel: {}, last: null, lastTier: 'offpeak' })
  // 纯 JSON：可被 structuredClone / 持久化缓存。
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state)
  const value = projection.view(state)
  assert.deepEqual(value, { models: [], lastTier: 'offpeak' })
  tokenCostSchema.parse(value) // wire schema 校验通过
})

test('无关事件与无 usage / 无 model 事件返回同一引用', () => {
  const projection = createTokenCostProjection()
  let state = projection.init()
  const unrelated = { type: 'user/message', seq: 1, time: 0, data: {} }
  assert.equal(projection.apply(state, unrelated), state)
  const noUsage = { type: 'assistant/message', seq: 2, time: 0, data: { turn: 1, step: 0, message: {}, usage: undefined } }
  assert.equal(projection.apply(state, noUsage), state)
  const noModel = assistantMessage({ turn: 1, step: 0, model: undefined, usage: { inputTokens: 1, outputTokens: 1 } })
  assert.equal(projection.apply(state, noModel), state)
})

test('单模型：高峰时段请求计入 peak 桶', () => {
  const projection = createTokenCostProjection()
  let state = projection.init()
  state = projection.apply(state, assistantMessage({
    turn: 1, step: 0, model: 'deepseek-v4-flash',
    usage: { inputTokens: 100_000, cacheReadTokens: 400_000, outputTokens: 50_000 },
    time: beijingTime(10), // 高峰
  }))
  const value = projection.view(state)
  assert.equal(value.lastTier, 'peak')
  assert.equal(value.models.length, 1)
  const row = value.models[0]
  assert.equal(row.model, 'deepseek-v4-flash')
  assert.deepEqual(row.peak, {
    uncachedInputTokens: 100_000,
    cacheReadTokens: 400_000,
    cacheWriteTokens: 0,
    outputTokens: 50_000,
  })
  assert.deepEqual(row.offpeak, emptyBucket)
})

test('同一模型跨时段：peak 与 offpeak 各自累计', () => {
  const projection = createTokenCostProjection()
  let state = projection.init()
  state = projection.apply(state, assistantMessage({
    turn: 1, step: 0, model: 'deepseek-v4-flash',
    usage: { inputTokens: 1000, outputTokens: 500 },
    time: beijingTime(10),
  }))
  state = projection.apply(state, assistantMessage({
    turn: 2, step: 0, model: 'deepseek-v4-flash',
    usage: { inputTokens: 2000, outputTokens: 700 },
    time: beijingTime(0), // 空闲
  }))
  const value = projection.view(state)
  const row = value.models[0]
  assert.deepEqual(row.peak, { uncachedInputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 500 })
  assert.deepEqual(row.offpeak, { uncachedInputTokens: 2000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 700 })
  assert.equal(value.lastTier, 'offpeak')
  tokenCostSchema.parse(value)
})

test('多模型独立累计，view 按模型 id 排序', () => {
  const projection = createTokenCostProjection()
  let state = projection.init()
  state = projection.apply(state, assistantMessage({
    turn: 1, step: 0, model: 'deepseek-v4-pro',
    usage: { inputTokens: 20_000, outputTokens: 30_000 },
    time: beijingTime(10),
  }))
  state = projection.apply(state, assistantMessage({
    turn: 1, step: 1, model: 'deepseek-v4-flash',
    usage: { inputTokens: 10_000, outputTokens: 5_000 },
    time: beijingTime(11),
  }))
  const value = projection.view(state)
  assert.equal(value.models.length, 2)
  assert.deepEqual(value.models.map((m) => m.model), ['deepseek-v4-flash', 'deepseek-v4-pro'])
})

test('同一 (turn, step) 重复上报：替换而非叠加（同时段）', () => {
  const projection = createTokenCostProjection()
  let state = projection.init()
  state = projection.apply(state, assistantMessage({
    turn: 2, step: 0, model: 'deepseek-v4-flash',
    usage: { inputTokens: 1000, outputTokens: 500 },
    time: beijingTime(10),
  }))
  state = projection.apply(state, assistantMessage({
    turn: 2, step: 0, model: 'deepseek-v4-flash',
    usage: { inputTokens: 1200, outputTokens: 600 },
    time: beijingTime(10),
  }))
  const value = projection.view(state)
  const row = value.models[0]
  assert.deepEqual(row.peak, { uncachedInputTokens: 1200, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 600 })
  assert.deepEqual(row.offpeak, emptyBucket)
})

test('同一 (turn, step) 跨时段替换：旧样本从原时段扣除，新样本进新时段', () => {
  const projection = createTokenCostProjection()
  let state = projection.init()
  state = projection.apply(state, assistantMessage({
    turn: 3, step: 0, model: 'deepseek-v4-flash',
    usage: { inputTokens: 1000, outputTokens: 500 },
    time: beijingTime(10), // 先高峰
  }))
  state = projection.apply(state, assistantMessage({
    turn: 3, step: 0, model: 'deepseek-v4-flash',
    usage: { inputTokens: 2000, outputTokens: 800 },
    time: beijingTime(0), // 覆盖为空闲
  }))
  const value = projection.view(state)
  const row = value.models[0]
  assert.deepEqual(row.peak, emptyBucket) // 高峰样本被替换掉
  assert.deepEqual(row.offpeak, { uncachedInputTokens: 2000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 800 })
})

test('同一 (turn, step) 相同样本：返回同一引用（零下游工作）', () => {
  const projection = createTokenCostProjection()
  let state = projection.init()
  const event = assistantMessage({
    turn: 3, step: 0, model: 'deepseek-v4-flash',
    usage: { inputTokens: 100, outputTokens: 50 },
  })
  state = projection.apply(state, event)
  const again = assistantMessage({
    turn: 3, step: 0, model: 'deepseek-v4-flash',
    usage: { inputTokens: 100, outputTokens: 50 },
    time: event.time,
  })
  assert.equal(projection.apply(state, again), state)
})

test('未知模型同样分桶累计（价格由设置层决定）', () => {
  const projection = createTokenCostProjection()
  let state = projection.init()
  state = projection.apply(state, assistantMessage({
    turn: 1, step: 0, model: 'future-model',
    usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
    time: beijingTime(10),
  }))
  const value = projection.view(state)
  assert.equal(value.models[0].model, 'future-model')
  assert.equal(value.models[0].peak.uncachedInputTokens, 1_000_000)
})

test('多次请求累计（跨 turn/step）', () => {
  const projection = createTokenCostProjection()
  let state = projection.init()
  for (let turn = 1; turn <= 3; turn += 1) {
    state = projection.apply(state, assistantMessage({
      turn, step: 0, model: 'deepseek-v4-flash',
      usage: { inputTokens: 1000, outputTokens: 1000 },
      time: beijingTime(10),
    }))
  }
  const value = projection.view(state)
  assert.equal(value.models[0].peak.uncachedInputTokens, 3000)
  assert.equal(value.models[0].peak.outputTokens, 3000)
})
