/**
 * dsh-deepseek-cost 会话投影：tokenCost。
 *
 * 折叠 DSH 会话日志中的 `assistant/message` 事件（携带 provider 报告的 usage），
 * 按模型分桶累计三类 token（未缓存输入 / 缓存命中输入 / 缓存写入输入 / 输出），
 * 并用 DeepSeek 官方定价按请求发生的计费时段（高峰 / 空闲）折算费用（元）。
 *
 * 设计对齐内置 token-meter 投影（packages/llm/token-meter/src/usage-projection.ts）：
 *   - 纯同步 init/apply/view，state 为纯 JSON（可持久化缓存 / structuredClone）；
 *   - 单 `last` 槽做 turn/step 级替换语义：同一 (turn, step) 再次上报 usage 时，
 *     减去上一次样本再累加新样本，避免重试 / 覆盖上报造成重复计费；
 *   - 只折叠 `assistant/message`（最终样本，携带 model），不折叠
 *     `assistant/chunk` 的早期 usage 样本（无 model，且必被 message 覆盖）。
 *
 * 该投影经 sessionProjections 注册后，Host 会把变更以 `session/projection`
 * push 帧推给浏览器端，Client 用 useProjection('tokenCost') 直接读取。
 */

import { z } from 'zod'
import { costOf, rateTierAt, resolvePriceTable } from './pricing.js'

const costModelSchema = z.object({
  model: z.string().min(1),
  uncachedInputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costCny: z.number().nonnegative(),
})

/** tokenCost 投影的线上（wire）值结构。 */
export const tokenCostSchema = z.object({
  totalCostCny: z.number().nonnegative(),
  lastTier: z.enum(['peak', 'offpeak']),
  models: z.array(costModelSchema),
}).strict()

const zeroRow = () => ({
  uncachedInputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  costCny: 0,
})

const bucketsEqual = (left, right) => left.uncachedInputTokens === right.uncachedInputTokens
  && left.cacheReadTokens === right.cacheReadTokens
  && left.cacheWriteTokens === right.cacheWriteTokens
  && left.outputTokens === right.outputTokens
  && left.costCny === right.costCny

/**
 * 构造 tokenCost 投影定义。
 * @param {object} [config] 插件配置（见 pricing.resolvePriceTable）。
 */
export function createTokenCostProjection(config = {}) {
  const table = resolvePriceTable(config)

  return {
    key: 'tokenCost',
    schema: tokenCostSchema,
    stateVersion: 1,
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
      const nextRow = {
        uncachedInputTokens: usage.inputTokens,
        cacheReadTokens: usage.cacheReadTokens ?? 0,
        cacheWriteTokens: usage.cacheWriteTokens ?? 0,
        outputTokens: usage.outputTokens,
        costCny: 0,
      }
      const tier = rateTierAt(event.time)
      const rates = table[model] ?? table.__default
      nextRow.costCny = costOf(nextRow, rates[tier]).total

      const previous = state.last !== null && state.last.turn === turn && state.last.step === step
        ? state.last
        : null
      if (previous !== null
        && previous.model === model
        && previous.tier === tier
        && bucketsEqual(previous, nextRow)) {
        // 同一 (turn, step) 的重复样本且数值相同：引用不变，零下游工作。
        return state
      }

      let perModel = state.perModel
      if (previous !== null) {
        const prevRow = perModel[previous.model]
        if (prevRow !== undefined) {
          perModel = {
            ...perModel,
            [previous.model]: subtractRow(prevRow, previous),
          }
          // 减到全零的行从明细中移除，保持 view 干净。
          const pruned = perModel[previous.model]
          if (pruned.costCny === 0 && pruned.uncachedInputTokens === 0
            && pruned.cacheReadTokens === 0 && pruned.cacheWriteTokens === 0
            && pruned.outputTokens === 0) {
            const { [previous.model]: _drop, ...rest } = perModel
            perModel = rest
          }
        }
      }

      const current = perModel[model] ?? zeroRow()
      perModel = {
        ...perModel,
        [model]: addRow(current, nextRow),
      }

      return {
        perModel,
        last: { turn, step, model, tier, ...nextRow },
        lastTier: tier,
      }
    },
    view(state) {
      const models = Object.entries(state.perModel)
        .map(([model, row]) => ({ model, ...row }))
        .sort((a, b) => b.costCny - a.costCny)
      const totalCostCny = models.reduce((sum, row) => sum + row.costCny, 0)
      return { totalCostCny, lastTier: state.lastTier, models }
    },
  }
}

function addRow(row, delta) {
  return {
    uncachedInputTokens: row.uncachedInputTokens + delta.uncachedInputTokens,
    cacheReadTokens: row.cacheReadTokens + delta.cacheReadTokens,
    cacheWriteTokens: row.cacheWriteTokens + delta.cacheWriteTokens,
    outputTokens: row.outputTokens + delta.outputTokens,
    costCny: row.costCny + delta.costCny,
  }
}

function subtractRow(row, delta) {
  return {
    uncachedInputTokens: row.uncachedInputTokens - delta.uncachedInputTokens,
    cacheReadTokens: row.cacheReadTokens - delta.cacheReadTokens,
    cacheWriteTokens: row.cacheWriteTokens - delta.cacheWriteTokens,
    outputTokens: row.outputTokens - delta.outputTokens,
    costCny: row.costCny - delta.costCny,
  }
}
