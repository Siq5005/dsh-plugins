/**
 * dsh-deepseek-cost 定价模块（纯函数，可单测）。
 *
 * 定价快照取自 DeepSeek 官方文档「模型 & 价格」页（2026-08-17 抓取，
 * https://api-docs.deepseek.com/zh-cn/quick_start/pricing），单位为
 * 人民币元 / 百万 tokens。官方只发布人民币计价；计费区分「高峰 / 空闲」两个
 * 时段：空闲时段价格为高峰时段的一半。高峰时段为北京时间 9:00–12:00 与
 * 14:00–18:00，其余为空闲时段。
 *
 * DeepSeek 计费只有三个桶：缓存命中输入（cache hit）、缓存未命中输入
 * （cache miss）、输出。DSH 的 TokenUsage 中 cacheWriteTokens 在 DeepSeek
 * 侧不单独计费（缓存写入并入未命中输入），因此按未命中价计。
 */

/** 每百万 tokens 的一组三桶价格（元）。 */
export const RATE_KEYS = Object.freeze(['cacheMiss', 'cacheHit', 'output'])

/** 官方定价快照：模型 id → { name, peak, offpeak }。 */
export const DEFAULT_PRICES = Object.freeze({
  'deepseek-v4-flash': Object.freeze({
    name: 'DeepSeek-V4-Flash',
    peak: Object.freeze({ cacheMiss: 3.0, cacheHit: 0.10, output: 9.0 }),
    offpeak: Object.freeze({ cacheMiss: 1.5, cacheHit: 0.05, output: 4.5 }),
  }),
  'deepseek-v4-pro': Object.freeze({
    name: 'DeepSeek-V4-Pro',
    peak: Object.freeze({ cacheMiss: 9.0, cacheHit: 0.30, output: 27.0 }),
    offpeak: Object.freeze({ cacheMiss: 4.5, cacheHit: 0.15, output: 13.5 }),
  }),
})

/** 未知模型的兜底价（保守取最便宜的 Flash 档，可在 config.defaultRates 覆盖）。 */
export const DEFAULT_FALLBACK_RATES = Object.freeze({
  peak: DEFAULT_PRICES['deepseek-v4-flash'].peak,
  offpeak: DEFAULT_PRICES['deepseek-v4-flash'].offpeak,
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
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes()
  const peak = (minutes >= 9 * 60 && minutes < 12 * 60)
    || (minutes >= 14 * 60 && minutes < 18 * 60)
  return peak ? 'peak' : 'offpeak'
}

/**
 * 把 config（cordis.patch.yml 的 config / ctx.config）解析为定价表。
 * 返回普通对象：{ [modelId]: { name, peak, offpeak }, __default: { peak, offpeak } }。
 * config 形态（全部可选）：
 *   - models: [{ id, name?, peak: {cacheMiss, cacheHit, output}, offpeak? }] 按 id 覆盖默认价
 *   - defaultRates: { peak: {...}, offpeak: {...} } 覆盖未知模型兜底价
 * @param {object} [config]
 * @returns {{ [model: string]: object, __default: object }}
 */
export function resolvePriceTable(config = {}) {
  const table = { __default: { ...DEFAULT_FALLBACK_RATES } }
  for (const [id, entry] of Object.entries(DEFAULT_PRICES)) {
    table[id] = { name: entry.name, peak: entry.peak, offpeak: entry.offpeak }
  }
  const defaultRates = config.defaultRates
  if (defaultRates && defaultRates.peak) {
    table.__default = {
      peak: { ...defaultRates.peak },
      offpeak: { ...(defaultRates.offpeak ?? offpeakOf(defaultRates.peak)) },
    }
  }
  const overrides = Array.isArray(config.models) ? config.models : []
  for (const entry of overrides) {
    if (!entry || typeof entry.id !== 'string' || entry.id === '') continue
    const peak = entry.peak ?? table.__default.peak
    table[entry.id] = {
      name: typeof entry.name === 'string' ? entry.name : entry.id,
      peak: { ...peak },
      offpeak: { ...(entry.offpeak ?? offpeakOf(peak)) },
    }
  }
  return table
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
  // DeepSeek 无独立缓存写入桶：写入并入未命中输入价。
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
