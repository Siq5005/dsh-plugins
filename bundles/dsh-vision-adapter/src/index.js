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

export function apply(ctx, config) {
  if (config.enabled === false) return

  const imageMemory = createImageMemory(config.cacheSize)
  const answerCache = createAnswerCache(config.cacheSize, config.cacheTtlMs)
  const current = () => config

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
  const stealthDeps = () => ({
    delegateProvider: NATIVE_ROUTE,
    imageMemory,
    config: current,
    nativeAdapter: () => nativeAdapter,
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
    if (config.visionRoute !== false && !adapterAvailable(ctx.llm, VISION_ROUTE)) {
      try {
        const visionHandle = ctx.llm.registerAdapter([VISION_ROUTE], createStealthAdapter(ctx, stealthDeps()))
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
