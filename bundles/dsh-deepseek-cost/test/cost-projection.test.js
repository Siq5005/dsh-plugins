import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTokenCostProjection, tokenCostSchema } from '../src/cost-projection.js'
import { DEFAULT_PRICES } from '../src/pricing.js'

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

const FLASH_PEAK = DEFAULT_PRICES['deepseek-v4-flash'].peak

test('init 状态为纯 JSON，空日志 view 全零', () => {
  const projection = createTokenCostProjection()
  const state = projection.init()
  assert.deepEqual(state, { perModel: {}, last: null, lastTier: 'offpeak' })
  // 纯 JSON：可被 structuredClone / 持久化缓存。
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state)
  const value = projection.view(state)
  assert.deepEqual(value, { totalCostCny: 0, lastTier: 'offpeak', models: [] })
  tokenCostSchema.parse(value) // wire schema 校验通过
})

test('无关事件与无 usage 事件返回同一引用', () => {
  const projection = createTokenCostProjection()
  let state = projection.init()
  const unrelated = { type: 'user/message', seq: 1, time: 0, data: {} }
  assert.equal(projection.apply(state, unrelated), state)
  const noUsage = { type: 'assistant/message', seq: 2, time: 0, data: { turn: 1, step: 0, message: {}, usage: undefined } }
  assert.equal(projection.apply(state, noUsage), state)
  const noModel = assistantMessage({ turn: 1, step: 0, model: undefined, usage: { inputTokens: 1, outputTokens: 1 } })
  assert.equal(projection.apply(state, noModel), state)
})

test('单模型按官方高峰价累计费用', () => {
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
  assert.equal(row.uncachedInputTokens, 100_000)
  assert.equal(row.cacheReadTokens, 400_000)
  assert.equal(row.outputTokens, 50_000)
  const expected = 100_000 * FLASH_PEAK.cacheMiss / 1e6
    + 400_000 * FLASH_PEAK.cacheHit / 1e6
    + 50_000 * FLASH_PEAK.output / 1e6
  assert.ok(Math.abs(row.costCny - expected) < 1e-9)
  assert.ok(Math.abs(value.totalCostCny - expected) < 1e-9)
})

test('多模型独立累计，view 按费用降序', () => {
  const projection = createTokenCostProjection()
  let state = projection.init()
  state = projection.apply(state, assistantMessage({
    turn: 1, step: 0, model: 'deepseek-v4-flash',
    usage: { inputTokens: 10_000, outputTokens: 5_000 },
    time: beijingTime(10),
  }))
  state = projection.apply(state, assistantMessage({
    turn: 1, step: 1, model: 'deepseek-v4-pro',
    usage: { inputTokens: 20_000, outputTokens: 30_000 },
    time: beijingTime(11),
  }))
  const value = projection.view(state)
  assert.equal(value.models.length, 2)
  // pro 输出贵，费用应排前面。
  assert.equal(value.models[0].model, 'deepseek-v4-pro')
  assert.equal(value.models[1].model, 'deepseek-v4-flash')
  assert.ok(value.models[0].costCny > value.models[1].costCny)
  tokenCostSchema.parse(value)
})

test('同一 (turn, step) 重复上报：替换而非叠加', () => {
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
  assert.equal(row.uncachedInputTokens, 1200)
  assert.equal(row.outputTokens, 600)
  const expected = (1200 * FLASH_PEAK.cacheMiss + 600 * FLASH_PEAK.output) / 1e6
  assert.ok(Math.abs(value.totalCostCny - expected) < 1e-12)
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

test('高峰 / 空闲分时计价：同一用量不同时段费用不同', () => {
  const projection = createTokenCostProjection()
  const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 }
  const peak = projection.view(projection.apply(projection.init(), assistantMessage({
    turn: 1, step: 0, model: 'deepseek-v4-flash', usage, time: beijingTime(10),
  })))
  const offpeak = projection.view(projection.apply(projection.init(), assistantMessage({
    turn: 1, step: 0, model: 'deepseek-v4-flash', usage, time: beijingTime(0),
  })))
  assert.equal(peak.lastTier, 'peak')
  assert.equal(offpeak.lastTier, 'offpeak')
  assert.ok(Math.abs(peak.totalCostCny - offpeak.totalCostCny * 2) < 1e-9)
})

test('未知模型按兜底价计费，仍出现在明细', () => {
  const projection = createTokenCostProjection()
  let state = projection.init()
  state = projection.apply(state, assistantMessage({
    turn: 1, step: 0, model: 'future-model',
    usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
    time: beijingTime(10),
  }))
  const value = projection.view(state)
  assert.equal(value.models[0].model, 'future-model')
  const expected = (1e6 * FLASH_PEAK.cacheMiss + 1e6 * FLASH_PEAK.output) / 1e6
  assert.ok(Math.abs(value.totalCostCny - expected) < 1e-9)
})

test('config 可覆盖定价', () => {
  const projection = createTokenCostProjection({
    models: [{ id: 'deepseek-v4-flash', peak: { cacheMiss: 6.0, cacheHit: 0.5, output: 12.0 } }],
  })
  let state = projection.init()
  state = projection.apply(state, assistantMessage({
    turn: 1, step: 0, model: 'deepseek-v4-flash',
    usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
    time: beijingTime(10),
  }))
  const value = projection.view(state)
  const expected = (1e6 * 6.0 + 1e6 * 12.0) / 1e6
  assert.ok(Math.abs(value.totalCostCny - expected) < 1e-9)
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
  assert.equal(value.models[0].uncachedInputTokens, 3000)
  assert.equal(value.models[0].outputTokens, 3000)
})
