// dsh-deepseek-cost 浏览器端。
//  - composer 下方的 dock（官方统计行旁边）：显示当前对话累计费用，hover 看明细。
//  - 设置 → 费用统计：DeepSeek 官方模型只读展示默认定价；其他模型填写 flat 三桶价。
// 数据链路：token 用量来自 Host 的 tokenCost 会话投影（useProjection），
// 价格来自本地配置端点 /plugins/dsh-deepseek-cost/config（Host 设置命名空间）。
window.__ModuleLoader__.load({ id: 'dsh-deepseek-cost', factory: (require) => {
  const module = { exports: {} }
  const React = require('react')

  const CONFIG_ENDPOINT = '/plugins/dsh-deepseek-cost/config'

  // ---------- 定价 store（模块级共享：费用行与设置页共用） ----------
  let pricingCache = null
  let pricingPromise = null
  const pricingListeners = new Set()

  function emitPricing() {
    for (const listener of [...pricingListeners]) {
      try { listener() } catch { /* 一个监听器出错不拖垮其他监听器 */ }
    }
  }

  function fetchConfig(method, body) {
    return fetch(CONFIG_ENDPOINT, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    }).then(async (response) => {
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(`config request failed: ${response.status}${text ? ` (${text})` : ''}`)
      }
      return response.json()
    })
  }

  function loadPricing() {
    if (pricingCache !== null) return Promise.resolve(pricingCache)
    if (pricingPromise === null) {
      pricingPromise = fetchConfig('GET')
        .then((cfg) => { pricingCache = cfg; emitPricing(); return cfg })
        .finally(() => { pricingPromise = null })
    }
    return pricingPromise
  }

  function applyPricing(cfg) {
    pricingCache = cfg
    emitPricing()
  }

  function subscribePricing(listener) {
    pricingListeners.add(listener)
    return () => pricingListeners.delete(listener)
  }

  function usePricing() {
    const [cfg, setCfg] = React.useState(pricingCache)
    React.useEffect(() => {
      let active = true
      loadPricing()
        .then((value) => { if (active) setCfg(value) })
        .catch(() => { if (active) setCfg({ unavailable: true }) })
      const off = subscribePricing(() => setCfg(pricingCache))
      return () => { active = false; off() }
    }, [])
    return cfg
  }

  // ---------- 计价（纯展示逻辑，价格随设置即时生效） ----------
  // 官方模型 → 官方默认定价（高峰/空闲分时）；自定义模型 → 用户填写的 flat 价。
  function ratesFor(model, cfg) {
    const def = cfg && cfg.defaults ? cfg.defaults[model] : undefined
    if (def) return { kind: 'tiered', peak: def.peak, offpeak: def.offpeak }
    const custom = (cfg && Array.isArray(cfg.models) ? cfg.models : []).find((m) => m.id === model)
    if (custom) {
      return { kind: 'flat', flat: { cacheMiss: custom.cacheMiss, cacheHit: custom.cacheHit, output: custom.output } }
    }
    return null
  }

  function costOfBuckets(bucket, rates) {
    return (bucket.uncachedInputTokens * rates.cacheMiss
      + bucket.cacheReadTokens * rates.cacheHit
      + bucket.cacheWriteTokens * rates.cacheMiss
      + bucket.outputTokens * rates.output) / 1e6
  }

  function combineBuckets(a, b) {
    return {
      uncachedInputTokens: a.uncachedInputTokens + b.uncachedInputTokens,
      cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
      cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
      outputTokens: a.outputTokens + b.outputTokens,
    }
  }

  function bucketTokens(bucket) {
    return bucket.uncachedInputTokens + bucket.cacheReadTokens + bucket.cacheWriteTokens + bucket.outputTokens
  }

  function modelCost(row, rates) {
    if (rates.kind === 'tiered') {
      return costOfBuckets(row.peak, rates.peak) + costOfBuckets(row.offpeak, rates.offpeak)
    }
    return costOfBuckets(combineBuckets(row.peak, row.offpeak), rates.flat)
  }

  function modelLabel(model, cfg) {
    const def = cfg && cfg.defaults ? cfg.defaults[model] : undefined
    if (def && typeof def.name === 'string') return def.name.replace(/^DeepSeek-/, '')
    const custom = (cfg && Array.isArray(cfg.models) ? cfg.models : []).find((m) => m.id === model)
    if (custom && typeof custom.name === 'string' && custom.name !== '') return custom.name
    return model
  }

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

  function tokensDetail(row) {
    const parts = []
    const peak = row.peak
    const offpeak = row.offpeak
    if (peak.uncachedInputTokens > 0) parts.push(`高峰未缓存输入 ${formatTokens(peak.uncachedInputTokens)}`)
    if (peak.cacheReadTokens > 0) parts.push(`高峰缓存输入 ${formatTokens(peak.cacheReadTokens)}`)
    if (peak.outputTokens > 0) parts.push(`高峰输出 ${formatTokens(peak.outputTokens)}`)
    if (offpeak.uncachedInputTokens > 0) parts.push(`空闲未缓存输入 ${formatTokens(offpeak.uncachedInputTokens)}`)
    if (offpeak.cacheReadTokens > 0) parts.push(`空闲缓存输入 ${formatTokens(offpeak.cacheReadTokens)}`)
    if (offpeak.outputTokens > 0) parts.push(`空闲输出 ${formatTokens(offpeak.outputTokens)}`)
    const total = bucketTokens(peak) + bucketTokens(offpeak)
    return parts.length > 0 ? parts.join(' · ') : `${formatTokens(total)} tokens`
  }

  // ---------- 费用行（conversation.composer.dock） ----------
  // 颜色一律走 DSH 主题 token（--dsw-alias-*），深/浅色模式自动适配。
  const ROW_STYLE = {
    display: 'flex', alignItems: 'center', gap: 6,
    fontSize: 12, lineHeight: '20px',
    color: 'var(--dsw-alias-label-primary)',
    minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    cursor: 'default',
  }
  const SEP_STYLE = { opacity: 0.45 }
  const MONEY_STYLE = { fontWeight: 600 }

  function CostLine(props) {
    const value = props.useProjection('tokenCost')
    const cfg = usePricing()
    if (value === undefined || value === null || cfg === null || cfg.unavailable) return null
    const models = value.models
    if (!Array.isArray(models) || models.length === 0) return null

    const priced = []
    const unpriced = []
    for (const row of models) {
      const rates = ratesFor(row.model, cfg)
      if (rates === null) unpriced.push(row)
      else priced.push({ row, cost: modelCost(row, rates) })
    }
    const totalCost = priced.reduce((sum, item) => sum + item.cost, 0)
    if (totalCost <= 0 && unpriced.length === 0) return null

    const groups = []
    if (totalCost > 0) {
      const parts = [`费用 ¥${formatCny(totalCost)}`]
      if (priced.length > 1) {
        parts.push(priced.map((item) => `${modelLabel(item.row.model, cfg)} ¥${formatCny(item.cost)}`).join(' · '))
      }
      groups.push(parts.join('（') + (priced.length > 1 ? '）' : ''))
    }
    if (unpriced.length > 0) {
      groups.push(`${unpriced.length} 个模型未配置价格`)
    }

    const detailLines = []
    for (const item of priced) {
      detailLines.push(`${modelLabel(item.row.model, cfg)}：${tokensDetail(item.row)} = ¥${formatCny(item.cost)}`)
    }
    if (priced.length > 0 && unpriced.length > 0) detailLines.push('')
    for (const row of unpriced) {
      const total = bucketTokens(row.peak) + bucketTokens(row.offpeak)
      detailLines.push(`${modelLabel(row.model, cfg)}：${formatTokens(total)} tokens · 未配置价格`)
    }
    if (totalCost > 0) detailLines.push(`合计 ¥${formatCny(totalCost)}`)
    if (unpriced.length > 0) detailLines.push('请在 设置 → 费用统计 中为这些模型填写价格（每百万 tokens 元）')
    detailLines.push(`最近一次计费：${value.lastTier === 'peak' ? '高峰时段' : '空闲时段'}`)

    const ariaLabel = groups.join('，')
    return React.createElement('div', {
      title: detailLines.join('\n'),
      'aria-label': ariaLabel,
      style: ROW_STYLE,
      'data-testid': 'dsh-deepseek-cost-line',
    },
      groups.map((group, index) => React.createElement(React.Fragment, { key: group },
        index > 0 ? React.createElement('span', { style: SEP_STYLE }, ' | ') : null,
        React.createElement('span', { style: index === 0 && totalCost > 0 ? MONEY_STYLE : undefined }, group),
      )),
    )
  }

  // ---------- 费用统计设置页（settings.section） ----------
  // 颜色一律走 DSH 主题 token（--dsw-alias-*），深/浅色模式自动适配。
  const PAGE_STYLE = {
    display: 'grid', gap: 16, maxWidth: 720,
    padding: '4px 2px', color: 'var(--dsw-alias-label-primary)',
  }
  const CARD_STYLE = {
    listStyle: 'none', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 12,
    padding: 16, background: 'var(--dsw-alias-bg-layer-1)', display: 'grid', gap: 12,
  }
  const ROW_STYLE_2 = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }
  const LABEL_STYLE = { fontWeight: 600 }
  const INPUT_STYLE = {
    minWidth: 72, padding: '4px 8px', borderRadius: 8,
    border: '1px solid var(--dsw-alias-border-l2)',
    background: 'var(--dsw-alias-bg-layer-2)',
    color: 'var(--dsw-alias-label-primary)',
  }
  const SMALL_STYLE = { opacity: 0.65, fontSize: 12 }
  const TABLE_HEAD_STYLE = { textAlign: 'left', padding: '4px 10px', borderBottom: '1px solid var(--dsw-alias-border-l1)', fontWeight: 600 }
  const TABLE_CELL_STYLE = { padding: '4px 10px', borderBottom: '1px solid var(--dsw-alias-border-l1)' }
  const BUTTON_STYLE = {
    padding: '4px 10px', borderRadius: 8, cursor: 'pointer',
    border: '1px solid var(--dsw-alias-border-l2)',
    background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)',
  }

  function NumberInput({ value, onChange, width }) {
    return React.createElement('input', {
      type: 'number', min: 0, step: 'any', value, style: { ...INPUT_STYLE, ...(width ? { minWidth: width } : {}) },
      onChange: (event) => onChange(event.target.value),
    })
  }

  function SettingsPage() {
    const cfg = usePricing()
    const [draft, setDraft] = React.useState(null) // { enabled, models, balanceEnabled, balanceRefreshMinutes, balanceBaseUrl }
    const [status, setStatus] = React.useState('loading') // loading | ready | saving | saved | error
    const [errorText, setErrorText] = React.useState('')

    const balanceDraft = (cfg2) => ({
      balanceEnabled: cfg2.balanceEnabled === true,
      balanceRefreshMinutes: cfg2.balanceRefreshMinutes ?? 15,
      balanceBaseUrl: cfg2.balanceBaseUrl ?? '',
    })

    React.useEffect(() => {
      if (cfg !== null) {
        setDraft({
          enabled: cfg.enabled !== false,
          models: (cfg.models ?? []).map((m) => ({ ...m })),
          ...balanceDraft(cfg),
        })
        setStatus('ready')
      }
    }, [cfg])

    if (cfg && cfg.unavailable) {
      return React.createElement('div', { style: PAGE_STYLE },
        React.createElement('span', null, '费用设置尚未连接到 DSH Host。'),
      )
    }
    if (draft === null) {
      return React.createElement('div', { style: PAGE_STYLE },
        React.createElement('span', null, '正在读取费用设置…'),
      )
    }

    const updateModel = (index, field, value) => {
      setDraft((prev) => {
        const models = prev.models.map((m, i) => (i === index ? { ...m, [field]: value } : m))
        return { ...prev, models }
      })
      setStatus('ready')
    }

    const toggleEnabled = (next) => {
      setDraft((prev) => ({ ...prev, enabled: next }))
      setStatus('saving')
      setErrorText('')
      fetchConfig('PATCH', { enabled: next })
        .then((cfg2) => { applyPricing(cfg2); setStatus('saved') })
        .catch((error) => { setErrorText(error.message); setStatus('error') })
    }

    const patchBalance = (patch) => {
      setStatus('saving')
      setErrorText('')
      fetchConfig('PATCH', patch)
        .then((cfg2) => {
          applyPricing(cfg2)
          setDraft((prev) => ({ ...prev, ...balanceDraft(cfg2) }))
          setStatus('saved')
        })
        .catch((error) => { setErrorText(error.message); setStatus('error') })
    }

    const saveBalance = () => {
      const minutes = Number(draft.balanceRefreshMinutes)
      if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440 || !Number.isInteger(minutes)) {
        setErrorText('余额刷新间隔必须是 1–1440 的整数分钟')
        setStatus('error')
        return
      }
      const baseUrl = String(draft.balanceBaseUrl ?? '').trim()
      if (baseUrl !== '') {
        let parsed
        try { parsed = new URL(baseUrl) } catch { parsed = null }
        if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
          setErrorText('余额接口 base URL 必须是 http(s) 地址')
          setStatus('error')
          return
        }
      }
      patchBalance({
        balanceRefreshMinutes: minutes,
        ...(baseUrl === '' ? {} : { balanceBaseUrl: baseUrl }),
      })
    }

    const saveModels = () => {
      const cleaned = []
      for (const m of draft.models) {
        const id = String(m.id ?? '').trim()
        if (id === '') continue
        const rates = {}
        for (const key of ['cacheMiss', 'cacheHit', 'output']) {
          const num = Number(m[key])
          if (!Number.isFinite(num) || num < 0) {
            setErrorText(`模型 ${id} 的价格必须是 ≥0 的数字`)
            setStatus('error')
            return
          }
          rates[key] = num
        }
        const entry = { id, ...rates }
        if (typeof m.name === 'string' && m.name.trim() !== '') entry.name = m.name.trim()
        cleaned.push(entry)
      }
      setStatus('saving')
      setErrorText('')
      fetchConfig('PATCH', { models: cleaned })
        .then((cfg2) => {
          applyPricing(cfg2)
          setDraft({
            enabled: cfg2.enabled !== false,
            models: (cfg2.models ?? []).map((m) => ({ ...m })),
            ...balanceDraft(cfg2),
          })
          setStatus('saved')
        })
        .catch((error) => { setErrorText(error.message); setStatus('error') })
    }

    const defaults = cfg?.defaults ?? {}
    const officialRows = Object.entries(defaults)

    return React.createElement('div', { style: PAGE_STYLE, 'data-testid': 'dsh-deepseek-cost-settings' },
      React.createElement('div', null,
        React.createElement('strong', { style: { fontSize: 16 } }, '费用统计（DeepSeek 官方定价）'),
        React.createElement('p', { style: { margin: '5px 0 0', ...SMALL_STYLE } },
          '当前对话费用按模型计价：DeepSeek 官方模型自动使用官方默认定价（只读）；其他模型在此填写价格（每百万 tokens 元），保存后即时生效。'),
      ),
      React.createElement('label', { style: ROW_STYLE_2 },
        React.createElement('input', {
          type: 'checkbox', checked: draft.enabled, disabled: status === 'saving',
          onChange: (event) => toggleEnabled(event.target.checked),
        }),
        React.createElement('span', { style: LABEL_STYLE }, '启用费用统计'),
      ),
      React.createElement('div', { style: CARD_STYLE },
        React.createElement('div', { style: LABEL_STYLE }, 'DeepSeek 官方默认定价（每百万 tokens 元，只读）'),
        React.createElement('table', { style: { borderCollapse: 'collapse', fontSize: 13 } },
          React.createElement('thead', null,
            React.createElement('tr', null,
              React.createElement('th', { style: TABLE_HEAD_STYLE }, '模型'),
              React.createElement('th', { style: TABLE_HEAD_STYLE }, '高峰 · 未命中 / 命中 / 输出'),
              React.createElement('th', { style: TABLE_HEAD_STYLE }, '空闲 · 未命中 / 命中 / 输出'),
            ),
          ),
          React.createElement('tbody', null,
            officialRows.map(([id, entry]) => React.createElement('tr', { key: id },
              React.createElement('td', { style: TABLE_CELL_STYLE }, entry.name ?? id),
              React.createElement('td', { style: TABLE_CELL_STYLE },
                `${entry.peak.cacheMiss} / ${entry.peak.cacheHit} / ${entry.peak.output}`),
              React.createElement('td', { style: TABLE_CELL_STYLE },
                `${entry.offpeak.cacheMiss} / ${entry.offpeak.cacheHit} / ${entry.offpeak.output}`),
            )),
          ),
        ),
        React.createElement('span', { style: SMALL_STYLE },
          '高峰时段为北京时间 9:00–12:00 与 14:00–18:00；空闲时段为高峰半价。'),
      ),
      React.createElement('div', { style: CARD_STYLE },
        React.createElement('div', null,
          React.createElement('div', { style: LABEL_STYLE }, 'DeepSeek 账号余额（桌宠气泡）'),
          React.createElement('span', { style: SMALL_STYLE },
            '打开后，费用统计插件会通过当前 DEEPSEEK_API_KEY 定期查询官方余额，并把结果推送给桌宠（仅显示金额，不暴露密钥）。'),
        ),
        React.createElement('label', { style: ROW_STYLE_2 },
          React.createElement('input', {
            type: 'checkbox', checked: draft.balanceEnabled === true, disabled: status === 'saving',
            onChange: (event) => patchBalance({ balanceEnabled: event.target.checked }),
          }),
          React.createElement('span', { style: LABEL_STYLE }, '启用余额获取'),
        ),
        React.createElement('div', { style: ROW_STYLE_2 },
          React.createElement('span', { style: SMALL_STYLE }, '刷新间隔（分钟）'),
          React.createElement('input', {
            type: 'number', min: 1, max: 1440, step: 1, value: draft.balanceRefreshMinutes ?? 15,
            disabled: status === 'saving' || draft.balanceEnabled !== true,
            style: { ...INPUT_STYLE, minWidth: 84 },
            onChange: (event) => setDraft((prev) => ({ ...prev, balanceRefreshMinutes: event.target.value })),
          }),
          React.createElement('span', { style: SMALL_STYLE }, '接口 base URL（可选）'),
          React.createElement('input', {
            type: 'text', placeholder: 'https://api.deepseek.com', value: draft.balanceBaseUrl ?? '',
            disabled: status === 'saving' || draft.balanceEnabled !== true,
            style: { ...INPUT_STYLE, minWidth: 220 },
            onChange: (event) => setDraft((prev) => ({ ...prev, balanceBaseUrl: event.target.value })),
          }),
          React.createElement('button', {
            style: { ...BUTTON_STYLE, minWidth: 84 },
            disabled: status === 'saving' || draft.balanceEnabled !== true,
            onClick: saveBalance,
          }, '保存余额设置'),
        ),
      ),
      React.createElement('div', { style: CARD_STYLE },
        React.createElement('div', null,
          React.createElement('div', { style: LABEL_STYLE }, '其他模型价格（每百万 tokens 元）'),
          React.createElement('span', { style: SMALL_STYLE }, '用于非 DeepSeek 官方模型；不区分高峰/空闲时段。'),
        ),
        draft.models.length === 0
          ? React.createElement('span', { style: SMALL_STYLE }, '尚未配置自定义模型价格。')
          : draft.models.map((m, index) => React.createElement('div', { key: index, style: { ...ROW_STYLE_2, borderTop: '1px solid var(--dsw-alias-border-l1)', paddingTop: 10 } },
            React.createElement('input', {
              type: 'text', placeholder: '模型 id', value: m.id ?? '', style: { ...INPUT_STYLE, minWidth: 140 },
              onChange: (event) => updateModel(index, 'id', event.target.value),
            }),
            React.createElement('input', {
              type: 'text', placeholder: '展示名（可选）', value: m.name ?? '', style: { ...INPUT_STYLE, minWidth: 120 },
              onChange: (event) => updateModel(index, 'name', event.target.value),
            }),
            NumberInput({ value: m.cacheMiss ?? '', onChange: (v) => updateModel(index, 'cacheMiss', v), width: 84 }),
            React.createElement('span', { style: SMALL_STYLE }, '未命中'),
            NumberInput({ value: m.cacheHit ?? '', onChange: (v) => updateModel(index, 'cacheHit', v), width: 84 }),
            React.createElement('span', { style: SMALL_STYLE }, '命中'),
            NumberInput({ value: m.output ?? '', onChange: (v) => updateModel(index, 'output', v), width: 84 }),
            React.createElement('span', { style: SMALL_STYLE }, '输出'),
            React.createElement('button', {
              style: { ...BUTTON_STYLE, marginLeft: 'auto' },
              onClick: () => {
                setDraft((prev) => ({ ...prev, models: prev.models.filter((_, i) => i !== index) }))
                setStatus('ready')
              },
            }, '删除'),
          )),
        React.createElement('button', {
          style: { ...BUTTON_STYLE, alignSelf: 'flex-start' },
          onClick: () => {
            setDraft((prev) => ({ ...prev, models: [...prev.models, { id: '', name: '', cacheMiss: '', cacheHit: '', output: '' }] }))
            setStatus('ready')
          },
        }, '+ 添加模型'),
        React.createElement('div', { style: ROW_STYLE_2 },
          React.createElement('button', {
            style: { ...BUTTON_STYLE, padding: '6px 20px', fontWeight: 600 },
            disabled: status === 'saving' || status === 'loading',
            onClick: saveModels,
          }, '保存'),
          status === 'saving'
            ? React.createElement('span', { role: 'status' }, '保存中…')
            : status === 'saved'
            ? React.createElement('span', { role: 'status', style: { color: 'var(--dsw-alias-state-success-primary)' } }, '已保存 ✓')
            : status === 'error'
            ? React.createElement('span', { role: 'status', style: { color: 'var(--dsw-alias-state-error-primary)' } }, `保存失败：${errorText}`)
            : null,
        ),
      ),
    )
  }

  // ---------- 挂载 ----------
  function apply(ctx) {
    ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
      name: 'conversation.composer.dock',
      id: 'token-cost',
      order: 1,
    }, CostLine))
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: 'deepseek-cost',
      order: 25,
      label: '费用统计',
    }, SettingsPage))
  }

  module.exports = {
    name: 'dsh-deepseek-cost-client',
    inject: ['slots'],
    apply,
  }
  return module.exports
} })
