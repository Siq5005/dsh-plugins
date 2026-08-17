/**
 * Stealth 式路由接管：让 DeepSeek 主模型"无感"获得看图能力。
 *
 * 背景：官方 llm-deepseek 路由的 adapter 在序列化时拒绝一切 image block
 * （UNSUPPORTED_CONTENT），且主循环的模型请求是深冻结只读的——唯一的改写点是
 * adapter 层。本模块：
 *   1. 重建官方 DeepSeek adapter（读取同一 llm-deepseek 设置段与凭据），注册到
 *      隐藏路由（默认 deepseek-official-native）；
 *   2. 以 stealth adapter 接管公共路由 deepseek-official：模型目录与官方完全
 *      一致，但声明 inputModalities 含 image（模型选择器外观不变、图片轮能过
 *      准入）；stream() 把 image block 重写为文本（缓存描述 / 可选自动描述 /
 *      引用引导）后委托给隐藏的原生路由。
 * session log 保持原样（Web UI 照常显示图片），改写只发生在模型请求里。
 * @module dsh-vision-adapter/adapter
 */

import { DeepSeekAdapter, resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek'
import { getOrCreateAnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import { rewriteImageBlocks, rewriteForTextModel } from './rewrite.js'
import { callVisionModel } from './vision-client.js'

/** 隐藏的原生 DeepSeek 路由名。 */
export const NATIVE_ROUTE = 'deepseek-official-native'
/** 公共接管路由名（与官方一致）。 */
export const PUBLIC_ROUTE = 'deepseek-official'
/** 显式"自动识图"包装组路由名（未接管时的备选入口）。 */
export const VISION_ROUTE = 'deepseek-vision'

/**
 * 重建官方 DeepSeek adapter：llm-deepseek 设置段 + credentials 凭据 + 匿名
 * 用户 id，与官方 llm-deepseek 行完全一致（隐身接管的前提）。
 * @param {object} ctx
 */
export function createNativeDeepSeekAdapter(ctx) {
  const env = new Map()
  for (const [key, value] of Object.entries(process.env ?? {})) {
    if (value !== undefined) env.set(key, { value })
  }
  const options = () => {
    let raw
    try {
      const settings = ctx.get('settings')
      raw = settings && typeof settings.get === 'function' ? settings.get('llm-deepseek') : undefined
    } catch {
      raw = undefined
    }
    return resolveAdapterOptions(raw ?? {}, env)
  }
  const resolveApiKey = async (connection) => {
    const ref = connection && connection.apiKeyEnv
    const credentials = ctx.get('credentials')
    if (credentials !== undefined && ref !== undefined) {
      try {
        const hit = await credentials.resolve(ref)
        if (hit && typeof hit.value === 'string' && hit.value.length > 0) return hit.value
      } catch {
        /* fall through to the environment */
      }
    }
    if (ref !== undefined) {
      const ambient = env.get(ref)
      if (ambient !== undefined && typeof ambient.value === 'string' && ambient.value.length > 0) {
        return ambient.value
      }
    }
    throw new Error(`dsh-vision-adapter: 无法解析官方 DeepSeek 路由的 API key（${ref ?? 'unknown'}）`)
  }
  let userId
  const resolveUserId = () => {
    if (userId === undefined) userId = getOrCreateAnonymousUserId()
    return userId
  }
  return new DeepSeekAdapter({ options, resolveApiKey, resolveUserId })
}

/**
 * 可选自动描述：请求重写前，对"无缓存描述"的图片批量调用视觉模型生成描述并
 * 写入 imageMemory。仅在配置 autoCaption=true 时执行（阻塞主请求，谨慎启用）。
 * @param {Array<object>} messages - 模型请求消息。
 * @param {object} deps
 * @param {() => object} deps.config
 * @param {{ get(id: string): string|undefined, set(id: string, v: string): void }} deps.imageMemory
 * @param {typeof callVisionModel} [deps.callVision]
 * @returns {Promise<void>}
 */
export async function autoCaptionImages(messages, deps) {
  const config = deps.config()
  if (config.autoCaption !== true) return
  const { images } = rewriteImageBlocks(messages, (block) => block)
  const unique = new Map()
  for (const block of images) {
    const attachment = block && block.attachment ? block.attachment : {}
    const id = String(attachment.attachmentId ?? attachment.id ?? '')
    if (id !== '' && id !== 'unknown') unique.set(id, block)
  }
  const callVision = deps.callVision ?? callVisionModel
  for (const [id, block] of unique) {
    if (deps.imageMemory.get(id) !== undefined) continue
    const attachment = block.attachment
    let stored
    const attachments = deps.attachments ? deps.attachments() : undefined
    if (attachments === undefined) break
    try {
      stored = await attachments.readImage(attachment)
    } catch {
      continue // 读图失败不影响其他图片，也不阻断主请求
    }
    const result = await callVision({
      baseURL: config.baseURL,
      apiKey: config.apiKey,
      model: config.model,
      question: config.captionPrompt || '请用中文简要、准确地描述这张图片的关键内容。',
      images: [{ data: stored.data, mediaType: stored.ref.mediaType }],
      prompt: config.captionPrompt,
      timeoutMs: config.timeoutMs,
    })
    if (result.ok && result.text.trim() !== '') {
      deps.imageMemory.set(id, result.text)
    }
  }
}

/**
 * 创建 stealth / 包装组的 adapter 对象（对象字面量，符合 LlmAdapter 形状）。
 * @param {object} ctx
 * @param {object} deps
 * @param {string} deps.delegateProvider - 文本委托目标路由（隐藏原生路由）。
 * @param {{ get(id: string): string|undefined, set(id: string, v: string): void }} deps.imageMemory
 * @param {() => object} deps.config
 * @param {() => object} deps.nativeAdapter - 返回原生 adapter（listModels/resolveModel/retry 委托）。
 * @param {typeof callVisionModel} [deps.callVision]
 * @returns {object} adapter
 */
export function createStealthAdapter(ctx, deps) {
  const native = () => deps.nativeAdapter()
  const wrappedStream = {
    async *stream(options) {
      // 可选自动描述：先为无缓存图片生成描述（写入 imageMemory），再重写。
      await autoCaptionImages(options.messages ?? [], {
        config: deps.config,
        imageMemory: deps.imageMemory,
        callVision: deps.callVision,
        attachments: () => ctx.get('attachments'),
      })
      const { messages: rewritten } = rewriteForTextModel(options.messages ?? [], {
        imageMemory: deps.imageMemory,
      })
      yield* ctx.llm.stream({
        ...options,
        provider: deps.delegateProvider,
        messages: rewritten,
      })
    },
  }
  return {
    providerInfo(provider) {
      return { id: provider, name: 'DeepSeek' }
    },
    providerRetryPolicy(provider) {
      return native().providerRetryPolicy(provider)
    },
    async listModels(provider) {
      const listed = await native().listModels(provider)
      return (listed ?? []).map((model) => ({
        ...model,
        provider,
        inputModalities: ['text', 'image'],
      }))
    },
    async resolveModel(provider, model, signal) {
      const base = await native().resolveModel(provider, model, signal)
      return { ...base, provider, inputModalities: ['text', 'image'] }
    },
    ...wrappedStream,
  }
}

/**
 * 原生 adapter 的隐藏路由包装（模型目录对选择器隐藏，其余原样）。
 * @param {object} nativeAdapter
 */
export function createHiddenNativeAdapter(nativeAdapter) {
  return {
    providerInfo() {
      return { id: NATIVE_ROUTE, name: 'DeepSeek (native)' }
    },
    providerRetryPolicy(provider) {
      return nativeAdapter.providerRetryPolicy(provider)
    },
    async listModels() {
      return []
    },
    async resolveModel(provider, model, signal) {
      return nativeAdapter.resolveModel(provider, model, signal)
    },
    async *stream(options) {
      yield* nativeAdapter.stream(options)
    },
  }
}
