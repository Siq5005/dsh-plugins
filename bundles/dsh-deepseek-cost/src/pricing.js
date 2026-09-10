/**
 * dsh-deepseek-cost 定价模块（纯函数，可单测）。
 *
 * 定价快照取自 DeepSeek 官方文档「模型 & 价格」页（2026-09-10 抓取，
 * https://api-docs.deepseek.com/zh-cn/quick_start/pricing），单位为
 * 人民币元 / 百万 tokens。官方只发布人民币计价；计费区分「高峰 / 空闲」两个
 * 时段：空闲时段价格为高峰时段的一半。高峰时段为北京时间**周一至周五**
 * 9:00–12:00 与 14:00–18:00，其余时间（含周末）为空闲时段。
 *
 * 官方模型（2026-09-10 起）：
 *   - deepseek-flash（模型版本 DeepSeek-V4.1-Flash）：官方主推模型名；旧名
 *     deepseek-v4-flash 仍可调用但已下线，请求由 V4.1-Flash 服务并按 Flash
 *     价计费，故两者共用同一份 Flash 定价。
 *   - deepseek-v4-pro（模型版本 DeepSeek-V4-Pro-0813）：官方计划于北京时间
 *     2026-09-14 12:00 后把访问 deepseek-v4-pro 的请求路由到 V4.1 Flash 并
 *     按 Flash 价计费；此前仍按 Pro 价计费（本表保留 Pro 价）。
 *
 * 计费约定：
 *   - DeepSeek 官方模型（deepseek-flash / deepseek-v4-flash / deepseek-v4-pro）
 *     自动使用本表默认定价（只读，设置页展示）。
 *   - 其他模型由用户在「费用统计」设置页填写（flat 三桶价：未命中/命中/输出，
 *     每百万 tokens 元；不区分高峰空闲）。DSH 的 TokenUsage 中
 *     cacheWriteTokens 按未命中价计。
 */

/** 每百万 tokens 的一组三桶价格（元）。 */
export const RATE_KEYS = Object.freeze(['cacheMiss', 'cacheHit', 'output'])

// DeepSeek-V4.1-Flash 官方价（人民币 / 百万 tokens）。
const FLASH_PEAK = Object.freeze({ cacheMiss: 2.0, cacheHit: 0.04, output: 8.0 })
const FLASH_OFFPEAK = Object.freeze({ cacheMiss: 1.0, cacheHit: 0.02, output: 4.0 })
// DeepSeek-V4-Pro 官方价（人民币 / 百万 tokens）。
const PRO_PEAK = Object.freeze({ cacheMiss: 9.0, cacheHit: 0.30, output: 27.0 })
const PRO_OFFPEAK = Object.freeze({ cacheMiss: 4.5, cacheHit: 0.15, output: 13.5 })

const flashEntry = Object.freeze({
  name: 'DeepSeek-V4.1-Flash',
  peak: FLASH_PEAK,
  offpeak: FLASH_OFFPEAK,
})

/** 官方定价快照：模型 id → { name, peak, offpeak }。 */
export const DEFAULT_PRICES = Object.freeze({
  'deepseek-flash': flashEntry,
  // 旧模型名仍可调用，请求由 V4.1-Flash 服务并按 Flash 价计费。
  'deepseek-v4-flash': flashEntry,
  'deepseek-v4-pro': Object.freeze({
    name: 'DeepSeek-V4-Pro',
    peak: PRO_PEAK,
    offpeak: PRO_OFFPEAK,
  }),
})

/** 空闲时段价格 = 高峰时段价格的一半（官方规则）。 */
export function offpeakOf(peak) {
  return {
    cacheMiss: peak.cacheMiss / 2,
    cacheHit: peak.cacheHit / 2,
    output: peak.output / 2,
  }
}

/**
 * 判断一次请求的计费时段。
 * @param {number} timeMs Unix epoch 毫秒（对应会话事件 time 字段）。
 * @returns {'peak' | 'offpeak'} 高峰 / 空闲。
 */
export function rateTierAt(timeMs) {
  // 北京时间 = UTC+8，不随本地时区变化；用 UTC 字段读取即可。
  const d = new Date(timeMs + 8 * 3600e3)
  // 官方仅「周一至周五」区分高峰，周末全天空闲。
  const weekday = d.getUTCDay() >= 1 && d.getUTCDay() <= 5
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes()
  const peak = weekday
    && ((minutes >= 9 * 60 && minutes < 12 * 60)
      || (minutes >= 14 * 60 && minutes < 18 * 60))
  return peak ? 'peak' : 'offpeak'
}

/**
 * 计算一批 token 桶的费用（元）。
 * @param {{ uncachedInputTokens?: number, cacheReadTokens?: number, cacheWriteTokens?: number, outputTokens?: number }} buckets
 * @param {{ cacheMiss: number, cacheHit: number, output: number }} rates 每百万 tokens 价格（元）
 * @returns {{ uncachedInputCost: number, cacheReadCost: number, cacheWriteCost: number, outputCost: number, total: number }} 各项费用与合计（元）
 */
export function costOf(buckets, rates) {
  const uncachedInputTokens = buckets.uncachedInputTokens ?? 0
  const cacheReadTokens = buckets.cacheReadTokens ?? 0
  const cacheWriteTokens = buckets.cacheWriteTokens ?? 0
  const outputTokens = buckets.outputTokens ?? 0
  const uncachedInputCost = uncachedInputTokens * rates.cacheMiss / 1e6
  const cacheReadCost = cacheReadTokens * rates.cacheHit / 1e6
  // 无独立缓存写入桶：写入并入未命中输入价。
  const cacheWriteCost = cacheWriteTokens * rates.cacheMiss / 1e6
  const outputCost = outputTokens * rates.output / 1e6
  return {
    uncachedInputCost,
    cacheReadCost,
    cacheWriteCost,
    outputCost,
    total: uncachedInputCost + cacheReadCost + cacheWriteCost + outputCost,
  }
}
