/**
 * dsh-deepseek-cost 插件入口（Host 侧）。
 *
 * 职责：注册 `tokenCost` 会话投影——按模型累计当前对话已消耗的 token
 * （未缓存输入 / 缓存命中输入 / 缓存写入输入 / 输出），并按 DeepSeek 官方定价
 * 折算费用（元）。投影随会话日志重放，重启 / 压缩后仍准确；变更经
 * `session/projection` push 帧实时推给浏览器端。
 *
 * 配置（cordis.patch.yml 的 config）全部可选，改配置需重启生效：
 *   - enabled: 是否启用（默认 true）
 *   - defaultRates: { peak: {cacheMiss, cacheHit, output}, offpeak? } 未知模型兜底价
 *   - models: [{ id, name?, peak: {...}, offpeak? }] 按模型 id 覆盖官方定价
 */

import Schema from '@deepseek-ai/schemastery'
import { createTokenCostProjection } from './cost-projection.js'
import { DEFAULT_FALLBACK_RATES, DEFAULT_PRICES } from './pricing.js'

export const name = 'dsh-deepseek-cost'

const ratesShape = Schema.object({
  cacheMiss: Schema.number().min(0).description('未缓存输入（每百万 tokens，元）'),
  cacheHit: Schema.number().min(0).description('缓存命中输入（每百万 tokens，元）'),
  output: Schema.number().min(0).description('输出（每百万 tokens，元）'),
}).description('每百万 tokens 的一组三桶价格（元）')

export const Config = Schema.object({
  enabled: Schema.boolean().default(true).description('启用当前对话费用统计'),
  defaultRates: Schema.object({
    peak: ratesShape,
    offpeak: ratesShape,
  }).default(DEFAULT_FALLBACK_RATES).description('未知模型的兜底价（默认取 V4-Flash 档）'),
  models: Schema.array(Schema.object({
    id: Schema.string().required().description('模型 id（如 deepseek-v4-flash）'),
    name: Schema.string().description('展示名（缺省用 id）'),
    peak: ratesShape,
    offpeak: ratesShape,
  })).default([]).description('按模型 id 覆盖官方定价；offpeak 缺省为 peak 的一半'),
}).description('按 DeepSeek 官方定价统计当前对话的 token 用量与累计费用')

export function apply(ctx, config = {}) {
  if (config.enabled === false) return
  // 无 sessionProjections 的 headless 组装保持无感（与官方 apiproxy 同款姿势）。
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.effect(
      () => projectionCtx.sessionProjections.register(createTokenCostProjection(config)),
      'dsh-deepseek-cost: tokenCost projection',
    )
  })
}
