/**
 * dsh-deepseek-cost 会话投影：tokenCost。
 *
 * 折叠 DSH 会话日志中的 `assistant/message` 事件（携带 provider 报告的 usage），
 * 按模型 × 计费时段（高峰 / 空闲，见 pricing.rateTierAt）分桶累计四类 token：
 * 未缓存输入 / 缓存命中输入 / 缓存写入输入 / 输出。
 *
 * 投影只保留**纯 token 事实**，不做计价：价格是展示 / 设置层面的数据（官方
 * 默认定价 + 用户设置页填写的自定义模型价格），由浏览器端读取设置后即时折算。
 * 这样改价格无需重建投影、不丢累计，也不破坏投影的纯函数重放语义。
 *
 * 设计对齐内置 token-meter 投影（packages/llm/token-meter/src/usage-projection.ts）：
 *   - 纯同步 init/apply/view，state 为纯 JSON（可持久化缓存 / structuredClone）；
 *   - 单 `last` 槽做 turn/step 级替换语义：同一 (turn, step) 再次上报 usage 时，
 *     减去上一次样本再累加新样本，避免重试 / 覆盖上报造成重复计数；
 *   - 只折叠 `assistant/message`（最终样本，携带 model），不折叠
 *     `assistant/chunk` 的早期 usage 样本（无 model，且必被 message 覆盖）。
 *
 * 该投影经 sessionProjections 注册后，Host 会把变更以 `session/projection`
 * push 帧推给浏览器端，Client 用 useProjection('tokenCost') 直接读取。
 */

import { z } from 'zod'
import { rateTierAt } from './pricing.js'

const bucketSchema = z.object({
  uncachedInputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
}).strict()

/** tokenCost 投影的线上（wire）值结构：按模型 × 时段分桶，不含价格。 */
export const tokenCostSchema = z.object({
  models: z.array(z.object({
    model: z.string().min(1),
    peak: bucketSchema,
    offpeak: bucketSchema,
  })),
  lastTier: z.enum(['peak', 'offpeak']),
}).strict()

const zeroBucket = () => ({
  uncachedInputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
})

const zeroRow = () => ({ peak: zeroBucket(), offpeak: zeroBucket() })

const bucketEqual = (left, right) => left.uncachedInputTokens === right.uncachedInputTokens
  && left.cacheReadTokens === right.cacheReadTokens
  && left.cacheWriteTokens === right.cacheWriteTokens
  && left.outputTokens === right.outputTokens

const bucketEmpty = (bucket) => bucket.uncachedInputTokens === 0
  && bucket.cacheReadTokens === 0
  && bucket.cacheWriteTokens === 0
  && bucket.outputTokens === 0

/** 构造 tokenCost 投影定义（无配置：定价不在投影内）。 */
export function createTokenCostProjection() {
  return {
    key: 'tokenCost',
    schema: tokenCostSchema,
    stateVersion: 2,
    init: () => ({
      perModel: {},
      last: null,
      lastTier: 'offpeak',
    }),
    apply(state, event) {
      if (event.type !== 'assistant/message') return state
      const usage = event.data.usage
      const model = event.data.message?.source?.model
      if (usage === undefined || typeof model !== 'string' || model === '') return state

      const { turn, step } = event.data
      const tier = rateTierAt(event.time)
      const bucket = {
        uncachedInputTokens: usage.inputTokens,
        cacheReadTokens: usage.cacheReadTokens ?? 0,
        cacheWriteTokens: usage.cacheWriteTokens ?? 0,
        outputTokens: usage.outputTokens,
      }

      const previous = state.last !== null && state.last.turn === turn && state.last.step === step
        ? state.last
        : null
      if (previous !== null
        && previous.model === model
        && previous.tier === tier
        && bucketEqual(previous.bucket, bucket)) {
        // 同一 (turn, step) 的重复样本且数值相同：引用不变，零下游工作。
        return state
      }

      let perModel = state.perModel
      if (previous !== null) {
        perModel = subtractInto(perModel, previous.model, previous.tier, previous.bucket)
      }
      perModel = addInto(perModel, model, tier, bucket)

      return {
        perModel,
        last: { turn, step, model, tier, bucket },
        lastTier: tier,
      }
    },
    view(state) {
      const models = Object.entries(state.perModel)
        .filter(([, row]) => !bucketEmpty(row.peak) || !bucketEmpty(row.offpeak))
        .map(([model, row]) => ({ model, peak: row.peak, offpeak: row.offpeak }))
        .sort((a, b) => a.model.localeCompare(b.model))
      return { models, lastTier: state.lastTier }
    },
  }
}

function addInto(perModel, model, tier, bucket) {
  const row = perModel[model] ?? zeroRow()
  return {
    ...perModel,
    [model]: {
      peak: tier === 'peak' ? addBucket(row.peak, bucket) : row.peak,
      offpeak: tier === 'offpeak' ? addBucket(row.offpeak, bucket) : row.offpeak,
    },
  }
}

function subtractInto(perModel, model, tier, bucket) {
  const row = perModel[model]
  if (row === undefined) return perModel
  const nextRow = {
    peak: tier === 'peak' ? subtractBucket(row.peak, bucket) : row.peak,
    offpeak: tier === 'offpeak' ? subtractBucket(row.offpeak, bucket) : row.offpeak,
  }
  if (bucketEmpty(nextRow.peak) && bucketEmpty(nextRow.offpeak)) {
    const { [model]: _drop, ...rest } = perModel
    return rest
  }
  return { ...perModel, [model]: nextRow }
}

function addBucket(bucket, delta) {
  return {
    uncachedInputTokens: bucket.uncachedInputTokens + delta.uncachedInputTokens,
    cacheReadTokens: bucket.cacheReadTokens + delta.cacheReadTokens,
    cacheWriteTokens: bucket.cacheWriteTokens + delta.cacheWriteTokens,
    outputTokens: bucket.outputTokens + delta.outputTokens,
  }
}

function subtractBucket(bucket, delta) {
  return {
    uncachedInputTokens: bucket.uncachedInputTokens - delta.uncachedInputTokens,
    cacheReadTokens: bucket.cacheReadTokens - delta.cacheReadTokens,
    cacheWriteTokens: bucket.cacheWriteTokens - delta.cacheWriteTokens,
    outputTokens: bucket.outputTokens - delta.outputTokens,
  }
}
