/**
 * dsh-vision-adapter 插件入口（Host 侧）。
 *
 * 给 DeepSeek 主模型加"眼睛"：
 *   1. stealth 接管 deepseek-official 路由（模型选择器外观不变，声明 image
 *      输入）；stream 层把 image block 重写为文本（缓存描述 / 可选自动描述 /
 *      引用引导）后委托给重建的原生 DeepSeek adapter。session log 保持原样。
 *   2. 注册 analyze_image 工具：主模型按需把 attachmentId + 问题交给用户配置
 *      的 OpenAI 兼容多模态端点，文字答案回主模型（内容哈希缓存 + 失败语义）。
 *   3. 注册 deepseek-vision 包装组路由：未接管（官方行在场）时的备选入口，
 *      在模型选择器里手动选择即可发图。
 *
 * 依赖：本插件直接访问 ctx.tools / ctx.llm，必须声明
 * `export const inject = ['tools', 'llm']`（Cordis 严格模式：未注入访问服务
 * 会抛 "cannot get property without inject" 并导致 harness 启动崩溃）。
 * attachments / settings / credentials 均通过 ctx.get / ctx.inject 动态获取。
 *
 * 两种启用方式：
 *   A. 无感接管（推荐）：profile 补丁层禁用官方 llm-deepseek 行（见
 *      cordis.patch.yml 注释），插件自动接管 deepseek-official。
 *   B. 显式包装组：官方行保留，模型选择器里选「DeepSeek (vision)」组。
 *
 * yml 配置（cordis.patch.yml 的 config，改配置需重启生效）：
 *   - enabled: 是否启用（默认 true）
 *   - baseURL / apiKey / model: OpenAI 兼容多模态端点（apiKey 建议
 *     !!js process.env.VISION_API_KEY）
 *   - autoCaption: 是否在请求前自动为无缓存图片生成描述（默认 false，
 *     按需为主；开启后每次新图阻塞一次视觉调用）
 *   - captionPrompt / timeoutMs / cacheSize / cacheTtlMs
 */

import Schema from '@deepseek-ai/schemastery'
import { createAnalyzeImageTool } from './analyze-tool.js'
import { createImageMemory, createAnswerCache } from './image-memory.js'
import {
  createNativeDeepSeekAdapter,
  createStealthAdapter,
  createHiddenNativeAdapter,
  NATIVE_ROUTE,
  PUBLIC_ROUTE,
  VISION_ROUTE,
} from './adapter.js'

export const name = 'dsh-vision-adapter'
export const inject = ['tools', 'llm']
export const CONFIG_ENDPOINT = '/plugins/dsh-vision-adapter/config'

/** 设置页可 PATCH 的字段白名单。 */
const PATCHABLE_FIELDS = new Set([
  'enabled', 'baseURL', 'apiKey', 'model', 'autoCaption', 'captionPrompt',
  'timeoutMs', 'cacheSize', 'cacheTtlMs', 'takeover', 'visionRoute',
])

export const Config = Schema.object({
  enabled: Schema.boolean().default(true).description('是否启用 dsh-vision-adapter'),
  baseURL: Schema.string().default('https://api.openai.com/v1')
    .description('OpenAI 兼容多模态端点基址（含 /v1，如 https://api.openai.com/v1；支持 siliconflow / 智谱 / OpenRouter 等）'),
  apiKey: Schema.string().default('').description('多模态端点 API key（建议用 !!js process.env.VISION_API_KEY 注入）'),
  model: Schema.string().default('gpt-4o-mini').description('多模态模型 id（如 gpt-4o-mini / qwen-vl-plus / glm-4v-flash）'),
  autoCaption: Schema.boolean().default(false)
    .description('请求前自动为无缓存图片生成描述（默认 false：按需为主，主模型通过 analyze_image 主动看图）'),
  captionPrompt: Schema.string().default('')
    .description('自动描述 / 工具 system 提示；留空用内置默认（中文描述图片关键内容）'),
  timeoutMs: Schema.number().min(1000).default(60000).description('单次视觉调用超时（毫秒）'),
  cacheSize: Schema.number().min(1).default(500).description('图片描述记忆与问答缓存的条目上限'),
  cacheTtlMs: Schema.number().min(0).default(6 * 60 * 60 * 1000).description('问答缓存 TTL（毫秒，0 为不过期）'),
  takeover: Schema.boolean().default(true).description('是否尝试接管 deepseek-official 路由（官方行不在场时生效）'),
  visionRoute: Schema.boolean().default(true).description('是否注册 deepseek-vision 包装组路由'),
}).description('给 DeepSeek 主模型加"眼睛"：图片在 adapter 层改写为文本，analyze_image 工具按需调用多模态端点')

/** 检查某 provider 路由是否已有注册的 adapter。 */
function adapterAvailable(llm, provider) {
  try {
    llm.registration(provider)
    return true
  } catch {
    return false
  }
}

/** 去掉对象里的 undefined 字段（settings 与 yml 配置合并时用）。 */
function omitUndefined(value) {
  if (value === null || typeof value !== 'object') return {}
  const out = {}
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) out[key] = item
  }
  return out
}

/** 设置命名空间初始值（patch 配置的公开字段）。 */
function publicConfig(config = {}) {
  return omitUndefined(config)
}

/** 无设置服务的环境回退：只读本地值。 */
function localSettingsScope(value) {
  return {
    get: () => value,
    update: async () => {},
    watch: () => () => {},
  }
}

function jsonResponse(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}

function isLoopback(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/** PATCH 载荷白名单清洗（防未知字段注入设置文档）。 */
export function sanitizeConfigPatch(value) {
  if (value === null || typeof value !== 'object') return {}
  const out = {}
  for (const [key, item] of Object.entries(value)) {
    if (PATCHABLE_FIELDS.has(key) && item !== undefined) out[key] = item
  }
  return out
}

/** 配置端点的 GET 载荷：完整公开设置（含默认值）。 */
export function configPayload(settings) {
  return omitUndefined(settings.get())
}

/**
 * 本地配置端点 handler：GET 返回当前设置；PATCH 更新（白名单清洗）。
 * 仅接受回环地址 + 同源请求（与 dsh-deepseek-cost 相同的本地安全约定）。
 */
export function createConfigHandler(settings) {
  return async (req, res) => {
    if (!isLoopback(req.socket?.remoteAddress)) {
      jsonResponse(res, 403, { error: 'local access only' })
      return
    }
    const origin = req.headers?.origin
    if (origin) {
      let originHost
      try { originHost = new URL(origin).host } catch {}
      if (!originHost || originHost !== req.headers.host) {
        jsonResponse(res, 403, { error: 'origin mismatch' })
        return
      }
    }
    if (req.method === 'GET') {
      jsonResponse(res, 200, configPayload(settings))
      return
    }
    if (req.method !== 'PATCH') {
      jsonResponse(res, 405, { error: 'method not allowed' })
      return
    }
    try {
      const chunks = []
      let bytes = 0
      for await (const chunk of req) {
        bytes += chunk.length
        if (bytes > 64 * 1024) throw new Error('request body is too large')
        chunks.push(chunk)
      }
      const patch = sanitizeConfigPatch(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      await settings.update(patch)
      jsonResponse(res, 200, configPayload(settings))
    } catch (error) {
      jsonResponse(res, 400, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}

export function apply(ctx, config) {
  if (config.enabled === false) return

  const imageMemory = createImageMemory(config.cacheSize)
  const answerCache = createAnswerCache(config.cacheSize, config.cacheTtlMs)
  let current = () => config

  // ── 0. 设置命名空间 + 本地配置端点（WebUI 设置页读写，live 生效）────────
  if (typeof ctx.inject === 'function') {
    ctx.inject(['settings'], (settingsCtx) => {
      const settings = settingsCtx.settings?.register?.('dsh-vision-adapter', Config, {
        base: publicConfig(config),
        applies: 'live',
      }) ?? localSettingsScope(publicConfig(config))
      // 运行时配置 = yml patch 默认 + 设置文档覆盖（设置页保存后即时生效）。
      current = () => ({ ...config, ...omitUndefined(settings.get()) })
      ctx.inject(['webServer'], (httpCtx) => {
        httpCtx.effect(
          () => httpCtx.webServer.register({ kind: 'exact', path: CONFIG_ENDPOINT, handler: createConfigHandler(settings) }),
          'dsh-vision-adapter: local config endpoint',
        )
      })
    })
  }

  // ── 1. 工具：主模型按需看图 ──────────────────────────────────────────────
  ctx.tools.register(createAnalyzeImageTool(ctx, { config: current, imageMemory, answerCache }))

  // ── 2. 重建原生 DeepSeek adapter（隐身接管与包装组的共同文本底座）───────
  let nativeAdapter
  try {
    nativeAdapter = createNativeDeepSeekAdapter(ctx)
  } catch (error) {
    ctx.logger?.warn(
      'dsh-vision-adapter: 无法重建原生 DeepSeek adapter（%s）；隐身接管与 deepseek-vision 包装组不可用，仅保留 analyze_image 工具',
      error && error.message ? error.message : String(error),
    )
  }
  const stealthDeps = (overrides = {}) => ({
    delegateProvider: NATIVE_ROUTE,
    imageMemory,
    config: current,
    nativeAdapter: () => nativeAdapter,
    ...overrides,
  })

  if (nativeAdapter !== undefined) {
    try {
      const hiddenHandle = ctx.llm.registerAdapter([NATIVE_ROUTE], createHiddenNativeAdapter(nativeAdapter))
      ctx.effect(() => hiddenHandle, 'dsh-vision-adapter: hidden native deepseek route')
    } catch (error) {
      ctx.logger?.warn(
        'dsh-vision-adapter: 注册隐藏原生路由失败（%s）',
        error && error.message ? error.message : String(error),
      )
    }

    // ── 3. deepseek-vision 包装组：显式入口，官方行保留时手动选择 ─────────
    // 显示名用「DeepSeek (vision)」，与官方 DeepSeek 组区分开。
    if (config.visionRoute !== false && !adapterAvailable(ctx.llm, VISION_ROUTE)) {
      try {
        const visionHandle = ctx.llm.registerAdapter(
          [VISION_ROUTE],
          createStealthAdapter(ctx, stealthDeps({ displayName: 'DeepSeek (vision)' })),
        )
        ctx.effect(() => visionHandle, 'dsh-vision-adapter: vision route')
      } catch (error) {
        ctx.logger?.warn(
          'dsh-vision-adapter: 注册 deepseek-vision 路由失败（%s）',
          error && error.message ? error.message : String(error),
        )
      }
    }

    // ── 4. stealth 接管 deepseek-official（官方行不在场时）─────────────────
    // 延迟决定：本行可能与官方 llm-deepseek 行并发 apply，立即判定会把尚未
    // 注册的官方路由误读为"缺席"而撞 DUPLICATE_ADAPTER。
    if (config.takeover !== false) {
      const KEEPALIVE_SETTLE_MS = 2000
      let takeoverSettled = false
      let takeoverAttempted = false
      const attemptTakeover = () => {
        if (takeoverAttempted || nativeAdapter === undefined) return
        takeoverAttempted = true
        try {
          const publicHandle = ctx.llm.registerAdapter([PUBLIC_ROUTE], createStealthAdapter(ctx, stealthDeps()))
          ctx.effect(() => publicHandle, 'dsh-vision-adapter: stealth deepseek-official route')
          ctx.logger?.info('dsh-vision-adapter: 已接管 deepseek-official 路由（图片轮自动走视觉）')
        } catch (error) {
          ctx.logger?.warn(
            'dsh-vision-adapter: 接管 deepseek-official 失败（%s）；官方行在场时可手动选择 deepseek-vision 包装组',
            error && error.message ? error.message : String(error),
          )
        }
      }
      const maybeTakeover = () => {
        if (takeoverSettled && !takeoverAttempted && !adapterAvailable(ctx.llm, PUBLIC_ROUTE)) {
          attemptTakeover()
        }
      }
      const settleTimer = setTimeout(() => {
        takeoverSettled = true
        maybeTakeover()
      }, KEEPALIVE_SETTLE_MS)
      ctx.effect(() => () => clearTimeout(settleTimer), 'dsh-vision-adapter: takeover settle timer')
      // 官方行在 settle 窗口内注册/注销时也复查一次。
      ctx.on('llm/adapters-updated', () => maybeTakeover())
    }

    // 官方行被禁用后，模型设置页的 DeepSeek 编辑入口由我们补上。
    try {
      ctx.llm.registerConfigurableProviders([
        {
          provider: PUBLIC_ROUTE,
          displayName: 'DeepSeek',
          settingsNs: 'llm-deepseek',
          settingsPath: [],
        },
      ])
    } catch {
      /* 官方行可能仍持有该目录条目 */
    }
  }
}
