import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_PRICES,
  costOf,
  offpeakOf,
  rateTierAt,
} from '../src/pricing.js'

// 构造北京时间某时刻的 epoch 毫秒（北京 = UTC+8）。
function beijingTime(hour, minute = 0) {
  return Date.UTC(2026, 0, 1, hour - 8, minute)
}

test('rateTierAt: 高峰时段为北京时间 9-12 与 14-18 点', () => {
  assert.equal(rateTierAt(beijingTime(9, 0)), 'peak')
  assert.equal(rateTierAt(beijingTime(11, 59)), 'peak')
  assert.equal(rateTierAt(beijingTime(12, 0)), 'offpeak')
  assert.equal(rateTierAt(beijingTime(13, 59)), 'offpeak')
  assert.equal(rateTierAt(beijingTime(14, 0)), 'peak')
  assert.equal(rateTierAt(beijingTime(17, 59)), 'peak')
  assert.equal(rateTierAt(beijingTime(18, 0)), 'offpeak')
  assert.equal(rateTierAt(beijingTime(0, 0)), 'offpeak')
  assert.equal(rateTierAt(beijingTime(8, 59)), 'offpeak')
})

test('rateTierAt: 不受本地时区影响（同一时刻不同本地时区结果一致）', () => {
  const t = Date.UTC(2026, 0, 1, 2, 0) // 北京 10:00 = UTC 02:00
  assert.equal(rateTierAt(t), 'peak')
})

test('DEFAULT_PRICES: 覆盖官方两个模型且三桶齐全', () => {
  assert.deepEqual(
    Object.keys(DEFAULT_PRICES).sort(),
    ['deepseek-v4-flash', 'deepseek-v4-pro'],
  )
  for (const entry of Object.values(DEFAULT_PRICES)) {
    for (const tier of ['peak', 'offpeak']) {
      for (const key of ['cacheMiss', 'cacheHit', 'output']) {
        assert.ok(entry[tier][key] >= 0, `${entry.name} ${tier} ${key}`)
      }
    }
  }
})

test('costOf: 每百万 tokens 按官方价折算（元）', () => {
  const flashPeak = DEFAULT_PRICES['deepseek-v4-flash'].peak
  const cost = costOf({
    uncachedInputTokens: 1_000_000,
    cacheReadTokens: 1_000_000,
    outputTokens: 1_000_000,
  }, flashPeak)
  assert.equal(cost.uncachedInputCost, 3.0)
  assert.equal(cost.cacheReadCost, 0.1)
  assert.equal(cost.outputCost, 9.0)
  assert.equal(cost.total, 12.1)
})

test('costOf: 小样本按比例折算，缓存写入并入未命中价', () => {
  const flashOffpeak = DEFAULT_PRICES['deepseek-v4-flash'].offpeak
  const cost = costOf({
    uncachedInputTokens: 1000,
    cacheReadTokens: 1000,
    cacheWriteTokens: 1000,
    outputTokens: 1000,
  }, flashOffpeak)
  assert.ok(Math.abs(cost.uncachedInputCost - 0.0015) < 1e-12)
  assert.ok(Math.abs(cost.cacheReadCost - 0.00005) < 1e-12)
  assert.ok(Math.abs(cost.cacheWriteCost - 0.0015) < 1e-12) // 写入 = 未命中价
  assert.ok(Math.abs(cost.outputCost - 0.0045) < 1e-12)
  assert.ok(Math.abs(cost.total - 0.00755) < 1e-12)
})

test('costOf: 缺省字段按 0 处理', () => {
  const cost = costOf({ outputTokens: 100 }, DEFAULT_PRICES['deepseek-v4-pro'].peak)
  assert.equal(cost.uncachedInputCost, 0)
  assert.equal(cost.cacheReadCost, 0)
  assert.ok(Math.abs(cost.outputCost - 100 * 27 / 1e6) < 1e-12)
})

test('offpeakOf: 空闲 = 高峰一半', () => {
  assert.deepEqual(offpeakOf({ cacheMiss: 3.0, cacheHit: 0.10, output: 9.0 }), {
    cacheMiss: 1.5, cacheHit: 0.05, output: 4.5,
  })
})
