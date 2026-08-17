// dsh-deepseek-cost 浏览器端：在 composer 下方的 dock（官方统计行旁边）
// 显示当前对话的累计费用（元），hover 看各模型明细。
// 数据来自 Host 的 tokenCost 会话投影：useProjection('tokenCost')。
window.__ModuleLoader__.load({ id: 'dsh-deepseek-cost', factory: (require) => {
  const module = { exports: {} }
  const React = require('react')

  const MODEL_LABELS = {
    'deepseek-v4-flash': 'V4-Flash',
    'deepseek-v4-pro': 'V4-Pro',
  }

  const ROW_STYLE = {
    display: 'flex', alignItems: 'center', gap: 6,
    fontSize: 12, lineHeight: '20px',
    color: 'var(--text-color, #333)',
    minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    cursor: 'default',
  }
  const SEP_STYLE = { opacity: 0.45 }
  const MONEY_STYLE = { fontWeight: 600 }

  // 紧凑 token 数：517 / 12.2K / 517K / 1.2M
  function formatTokens(n) {
    const scaled = (v) => v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10)
    if (n < 1_000) return String(n)
    if (n < 1_000_000) return `${scaled(n / 1_000)}K`
    return `${scaled(n / 1_000_000)}M`
  }

  // 金额：<1 元保留 4 位小数，否则 2 位；去尾零。
  function formatCny(value) {
    if (value === 0) return '0'
    const text = value < 1 ? value.toFixed(4) : value.toFixed(2)
    return text.replace(/\.?0+$/, '') || '0'
  }

  function modelLabel(model) {
    return MODEL_LABELS[model] ?? model
  }

  function costLineInline(value) {
    const { totalCostCny, models } = value
    const parts = [`费用 ¥${formatCny(totalCostCny)}`]
    if (models.length > 1) {
      parts.push(models
        .map((row) => `${modelLabel(row.model)} ¥${formatCny(row.costCny)}`)
        .join(' · '))
    }
    return parts
  }

  function costLineDetail(value) {
    const { models, lastTier } = value
    const lines = models.map((row) => {
      const tokens = []
      if (row.uncachedInputTokens > 0) tokens.push(`未缓存输入 ${formatTokens(row.uncachedInputTokens)}`)
      if (row.cacheReadTokens > 0) tokens.push(`缓存输入 ${formatTokens(row.cacheReadTokens)}`)
      if (row.cacheWriteTokens > 0) tokens.push(`缓存写入 ${formatTokens(row.cacheWriteTokens)}`)
      if (row.outputTokens > 0) tokens.push(`输出 ${formatTokens(row.outputTokens)}`)
      return `${modelLabel(row.model)}：${tokens.join(' · ') || '0 token'} = ¥${formatCny(row.costCny)}`
    })
    lines.push(`合计 ¥${formatCny(value.totalCostCny)}`)
    lines.push(`最近一次计费：${lastTier === 'peak' ? '高峰时段' : '空闲时段'}（官方价，元/百万 tokens）`)
    return lines.join('\n')
  }

  function CostLine(props) {
    const value = props.useProjection('tokenCost')
    if (value === undefined) return null
    const { totalCostCny, models } = value
    if (!Array.isArray(models) || models.length === 0 || totalCostCny <= 0) return null
    const groups = costLineInline(value)
    const detail = costLineDetail(value)
    return React.createElement('div', {
      title: detail,
      'aria-label': groups.join('，'),
      style: ROW_STYLE,
      'data-testid': 'dsh-deepseek-cost-line',
    },
      groups.map((group, index) => React.createElement(React.Fragment, { key: group },
        index > 0 ? React.createElement('span', { style: SEP_STYLE }, ' | ') : null,
        React.createElement('span', { style: index === 0 ? MONEY_STYLE : undefined }, group),
      )),
    )
  }

  function apply(ctx) {
    ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
      name: 'conversation.composer.dock',
      id: 'token-cost',
      order: 1,
    }, CostLine))
  }

  module.exports = {
    name: 'dsh-deepseek-cost-client',
    inject: ['slots'],
    apply,
  }
  return module.exports
} })
