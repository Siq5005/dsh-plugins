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

test('rateTierAt: 高峰时段为北京时间工作日 9-12 与 14-18 点', () => {
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

test('rateTierAt: 周末全天空闲（官方高峰仅工作日）', () => {
  // 2026-01-03 为周六，2026-01-04 为周日。
  const saturdayMorning = Date.UTC(2026, 0, 3, 2, 0) // 北京 10:00
  const sundayAfternoon = Date.UTC(2026, 0, 4, 7, 0) // 北京 15:00
  assert.equal(rateTierAt(saturdayMorning), 'offpeak')
  assert.equal(rateTierAt(sundayAfternoon), 'offpeak')
})

test('DEFAULT_PRICES: 覆盖官方模型（含旧名别名）且三桶齐全', () => {
  assert.deepEqual(
    Object.keys(DEFAULT_PRICES).sort(),
    ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-pro'],
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
  assert.equal(cost.uncachedInputCost, 2.0)
  assert.equal(cost.cacheReadCost, 0.04)
  assert.equal(cost.outputCost, 8.0)
  assert.equal(cost.total, 10.04)
})

test('costOf: 小样本按比例折算，缓存写入并入未命中价', () => {
  const flashOffpeak = DEFAULT_PRICES['deepseek-v4-flash'].offpeak
  const cost = costOf({
    uncachedInputTokens: 1000,
    cacheReadTokens: 1000,
    cacheWriteTokens: 1000,
    outputTokens: 1000,
  }, flashOffpeak)
  assert.ok(Math.abs(cost.uncachedInputCost - 0.001) < 1e-12)
  assert.ok(Math.abs(cost.cacheReadCost - 0.00002) < 1e-12)
  assert.ok(Math.abs(cost.cacheWriteCost - 0.001) < 1e-12) // 写入 = 未命中价
  assert.ok(Math.abs(cost.outputCost - 0.004) < 1e-12)
  assert.ok(Math.abs(cost.total - 0.00602) < 1e-12)
})

test('costOf: 缺省字段按 0 处理', () => {
  const cost = costOf({ outputTokens: 100 }, DEFAULT_PRICES['deepseek-v4-pro'].peak)
  assert.equal(cost.uncachedInputCost, 0)
  assert.equal(cost.cacheReadCost, 0)
  assert.ok(Math.abs(cost.outputCost - 100 * 27 / 1e6) < 1e-12)
})

test('offpeakOf: 空闲 = 高峰一半', () => {
  assert.deepEqual(offpeakOf({ cacheMiss: 2.0, cacheHit: 0.04, output: 8.0 }), {
    cacheMiss: 1.0, cacheHit: 0.02, output: 4.0,
  })
})
