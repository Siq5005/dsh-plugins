// dsh-vision-adapter 浏览器端。
//  - 设置 → 视觉适配：配置 OpenAI 兼容多模态端点（baseURL / apiKey / model）、
//    自动描述开关、超时与缓存等；保存后 live 生效（Host settings 命名空间）。
// 数据链路：设置经本地配置端点 /plugins/dsh-vision-adapter/config（GET/PATCH）
// 读写 Host 的 dsh-vision-adapter 设置命名空间（applies: live）。
window.__ModuleLoader__.load({ id: 'dsh-vision-adapter', factory: (require) => {
  const module = { exports: {} }
  const React = require('react')

  const CONFIG_ENDPOINT = '/plugins/dsh-vision-adapter/config'

  // ---------- 配置读写 ----------
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

  // ---------- 样式 ----------
  const PAGE_STYLE = { display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 560 }
  const ROW_STYLE = { display: 'flex', flexDirection: 'column', gap: 4 }
  const LABEL_STYLE = { fontSize: 13, fontWeight: 600 }
  const HINT_STYLE = { fontSize: 12, opacity: 0.6 }
  const INPUT_STYLE = {
    padding: '6px 10px', borderRadius: 8,
    border: '1px solid var(--border-color, #ccc)', background: 'var(--surface-color, #fff)',
    color: 'var(--text-color, #333)', fontFamily: 'inherit',
  }
  const CHECKBOX_STYLE = { accentColor: 'var(--accent-color, #5B4CF0)' }
  const SAVE_ROW_STYLE = { display: 'flex', alignItems: 'center', gap: 12 }

  function Field({ label, hint, children }) {
    return React.createElement('label', { style: ROW_STYLE },
      React.createElement('span', { style: LABEL_STYLE }, label),
      children,
      hint ? React.createElement('span', { style: HINT_STYLE }, hint) : null,
    )
  }

  function Toggle({ checked, onChange, label }) {
    return React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' } },
      React.createElement('input', {
        type: 'checkbox', checked, style: CHECKBOX_STYLE,
        onChange: (event) => onChange(event.target.checked),
      }),
      React.createElement('span', null, label),
    )
  }

  function SettingsPage() {
    const [draft, setDraft] = React.useState(null)
    const [status, setStatus] = React.useState('loading') // loading | ready | saving | saved | error
    const [errorText, setErrorText] = React.useState('')

    React.useEffect(() => {
      let active = true
      fetchConfig('GET')
        .then((cfg) => {
          if (!active) return
          setDraft({
            enabled: cfg.enabled !== false,
            baseURL: cfg.baseURL ?? '',
            apiKey: cfg.apiKey ?? '',
            model: cfg.model ?? '',
            autoCaption: cfg.autoCaption === true,
            captionPrompt: cfg.captionPrompt ?? '',
            timeoutSec: Math.round((cfg.timeoutMs ?? 60000) / 1000),
            cacheHours: Math.round((cfg.cacheTtlMs ?? 21600000) / 3600000),
            takeover: cfg.takeover !== false,
            visionRoute: cfg.visionRoute !== false,
          })
          setStatus('ready')
        })
        .catch(() => {
          if (!active) return
          setStatus('error')
          setErrorText('无法连接到 DSH Host 配置端点')
        })
      return () => { active = false }
    }, [])

    if (draft === null) {
      return React.createElement('div', { style: PAGE_STYLE },
        React.createElement('span', null, status === 'error' ? `加载失败：${errorText}` : '加载中…'))
    }

    const patch = (partial) => setDraft({ ...draft, ...partial })
    const save = async () => {
      setStatus('saving')
      try {
        const cfg = await fetchConfig('PATCH', {
          enabled: draft.enabled,
          baseURL: draft.baseURL.trim(),
          apiKey: draft.apiKey,
          model: draft.model.trim(),
          autoCaption: draft.autoCaption,
          captionPrompt: draft.captionPrompt,
          timeoutMs: Math.max(1, draft.timeoutSec) * 1000,
          cacheTtlMs: Math.max(0, draft.cacheHours) * 3600000,
          takeover: draft.takeover,
          visionRoute: draft.visionRoute,
        })
        setDraft({
          enabled: cfg.enabled !== false,
          baseURL: cfg.baseURL ?? '',
          apiKey: cfg.apiKey ?? '',
          model: cfg.model ?? '',
          autoCaption: cfg.autoCaption === true,
          captionPrompt: cfg.captionPrompt ?? '',
          timeoutSec: Math.round((cfg.timeoutMs ?? 60000) / 1000),
          cacheHours: Math.round((cfg.cacheTtlMs ?? 21600000) / 3600000),
          takeover: cfg.takeover !== false,
          visionRoute: cfg.visionRoute !== false,
        })
        setStatus('saved')
      } catch (error) {
        setStatus('error')
        setErrorText(error instanceof Error ? error.message : String(error))
      }
    }

    return React.createElement('div', { style: PAGE_STYLE },
      React.createElement('div', { style: { fontSize: 13, opacity: 0.75 } },
        '给 DeepSeek 主模型加"眼睛"：图片在 adapter 层改写为文本，analyze_image 工具按需调用下方多模态端点。' +
        '改动保存后即时生效；apiKey 建议用环境变量（!!js process.env.VISION_API_KEY）而非明文。'),
      React.createElement(Field, { label: '多模态端点 baseURL', hint: 'OpenAI 兼容端点，含 /v1（OpenAI / siliconflow / 智谱 / OpenRouter 等）' },
        React.createElement('input', {
          style: INPUT_STYLE, value: draft.baseURL, spellCheck: false,
          onChange: (event) => patch({ baseURL: event.target.value }),
        })),
      React.createElement(Field, { label: 'API key', hint: '明文保存在本机 profile 设置中；更推荐环境变量注入' },
        React.createElement('input', {
          style: INPUT_STYLE, type: 'password', value: draft.apiKey, spellCheck: false, autoComplete: 'off',
          onChange: (event) => patch({ apiKey: event.target.value }),
        })),
      React.createElement(Field, { label: '模型 id', hint: '如 gpt-4o-mini / qwen-vl-plus / glm-4v-flash' },
        React.createElement('input', {
          style: INPUT_STYLE, value: draft.model, spellCheck: false,
          onChange: (event) => patch({ model: event.target.value }),
        })),
      React.createElement(Field, { label: '自动描述 prompt', hint: '留空用内置默认（中文描述图片关键内容）；仅 autoCaption 开启时用作自动描述' },
        React.createElement('textarea', {
          style: { ...INPUT_STYLE, minHeight: 56, resize: 'vertical' }, value: draft.captionPrompt,
          onChange: (event) => patch({ captionPrompt: event.target.value }),
        })),
      React.createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' } },
        React.createElement(Field, { label: '超时（秒）' },
          React.createElement('input', {
            style: { ...INPUT_STYLE, width: 96 }, type: 'number', min: 1, value: draft.timeoutSec,
            onChange: (event) => patch({ timeoutSec: Number(event.target.value) }),
          })),
        React.createElement(Field, { label: '问答缓存（小时）' },
          React.createElement('input', {
            style: { ...INPUT_STYLE, width: 96 }, type: 'number', min: 0, value: draft.cacheHours,
            onChange: (event) => patch({ cacheHours: Number(event.target.value) }),
          })),
      ),
      React.createElement(Toggle, { checked: draft.enabled, onChange: (v) => patch({ enabled: v }), label: '启用' }),
      React.createElement(Toggle, { checked: draft.autoCaption, onChange: (v) => patch({ autoCaption: v }), label: '自动描述（贴图即分析；每次新图多一次视觉调用）' }),
      React.createElement(Toggle, { checked: draft.takeover, onChange: (v) => patch({ takeover: v }), label: '接管 deepseek-official 路由（官方行禁用时无感生效）' }),
      React.createElement(Toggle, { checked: draft.visionRoute, onChange: (v) => patch({ visionRoute: v }), label: '注册 deepseek-vision 包装组路由' }),
      React.createElement('div', { style: SAVE_ROW_STYLE },
        React.createElement('button', {
          style: {
            padding: '6px 16px', borderRadius: 8, cursor: 'pointer',
            border: '1px solid var(--border-color, #ccc)', background: 'var(--surface-color, #fff)',
          },
          onClick: save, disabled: status === 'saving',
        }, status === 'saving' ? '保存中…' : '保存'),
        status === 'saved'
          ? React.createElement('span', { role: 'status', style: { color: 'var(--success-color, #1a7f37)' } }, '已保存 ✓')
          : status === 'error'
            ? React.createElement('span', { role: 'status', style: { color: 'var(--danger-color, #c0392b)' } }, `保存失败：${errorText}`)
            : null,
      ),
    )
  }

  // ---------- 挂载 ----------
  function apply(ctx) {
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: 'vision-adapter',
      order: 26,
      label: '视觉适配',
    }, SettingsPage))
  }

  module.exports = {
    name: 'dsh-vision-adapter-client',
    inject: ['slots'],
    apply,
  }
  return module.exports
} })
