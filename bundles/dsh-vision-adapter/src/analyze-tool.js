/**
 * analyze_image 工具：主模型按需"看图"的入口。
 *
 * 主模型从重写后的文本标记里拿到 attachmentId 后，调用本工具：
 *   1. 从会话事件日志解析 ImageAttachmentRef（含完整元数据）；
 *   2. attachments.readImage(ref) 取回并校验图片字节；
 *   3. 按 内容哈希 + 问题 + 模型 命中问答缓存则直接返回；
 *   4. 否则调用用户配置的 OpenAI 兼容多模态端点，返回文字答案；
 *   5. 成功结果同时写入图片描述记忆（后续请求直接内嵌描述，不再重复调用）。
 *
 * 失败返回结构化 JSON：{ ok:false, code, retryable, reason }——retryable=false
 * 表示换问法重试无效，主模型应停止视觉请求、基于已有信息继续文本任务。
 * @module dsh-vision-adapter/analyze-tool
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { callVisionModel } from './vision-client.js'
import { lookupAttachmentRef } from './session-refs.js'
import { contentHash } from './image-memory.js'

const MAX_IMAGES = 4

/**
 * @param {object} ctx - Cordis 上下文（执行时取 attachments 服务）。
 * @param {object} deps
 * @param {() => object} deps.config - 返回当前插件配置（baseURL/apiKey/model/...）。
 * @param {{ get(id: string): string|undefined, set(id: string, v: string): void }} deps.imageMemory
 * @param {{ get(images, question, model), set(images, question, model, text) }} deps.answerCache
 * @param {typeof callVisionModel} [deps.callVision]
 */
export function createAnalyzeImageTool(ctx, deps) {
  const callVision = deps.callVision ?? callVisionModel
  const toolName = 'analyze_image'

  return defineTool({
    name: toolName,
    description:
      'Analyze images referenced by attachment id (e.g. sha256:...) in this conversation and answer a specific question about them. ' +
      'Pass 1-4 attachment ids from the [图片 ...] markers in your context. ' +
      'Returns a text answer from a vision model, or {ok:false,...} when the vision backend is unavailable (then continue the text task without retrying).',
    parameters: {
      attachmentIds: {
        type: 'array',
        items: { type: 'string' },
        required: true,
        description: `1-${MAX_IMAGES} 个图片附件 id（如 sha256:...），来自上下文中 [图片「...」] 标记`,
      },
      question: {
        type: 'string',
        required: true,
        description: '针对图片的具体问题（如"图中按钮的坐标是什么""总结这张图表的要点"）',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const ids = Array.isArray(args.attachmentIds) ? args.attachmentIds.map(String) : []
      if (ids.length === 0 || ids.length > MAX_IMAGES) {
        throw new Error(`${toolName}: 请提供 1-${MAX_IMAGES} 个 attachmentIds`)
      }
      const question = String(args.question ?? '').trim()
      if (question === '') throw new Error(`${toolName}: question 不能为空`)

      const config = deps.config()
      if (!config.enabled) {
        return JSON.stringify({ ok: false, code: 'VISION_DISABLED', retryable: false, reason: 'dsh-vision-adapter 已禁用' })
      }
      const attachments = ctx.get('attachments')
      if (attachments === undefined) {
        return JSON.stringify({ ok: false, code: 'VISION_OTHER', retryable: false, reason: '部署环境未挂载附件服务' })
      }

      const events = exec.agent && exec.agent.session ? exec.agent.session.events : undefined
      if (!Array.isArray(events)) {
        return JSON.stringify({ ok: false, code: 'VISION_OTHER', retryable: false, reason: '无法访问会话事件日志' })
      }

      // 解析每个 id 的引用并取回字节（缺任一 id 即整体失败，不给模型部分结果）。
      const images = []
      for (const id of ids) {
        const ref = lookupAttachmentRef(events, id)
        if (ref === undefined) {
          return JSON.stringify({
            ok: false,
            code: 'VISION_UNKNOWN_ATTACHMENT',
            retryable: false,
            reason: `未知附件 id "${id}"（必须来自本对话中上传的图片）`,
          })
        }
        let stored
        try {
          stored = await attachments.readImage(ref, exec.signal)
        } catch (error) {
          return JSON.stringify({
            ok: false,
            code: 'VISION_OTHER',
            retryable: false,
            reason: `读取附件 ${id} 失败：${error && error.message ? error.message : String(error)}`,
          })
        }
        images.push({ data: stored.data, mediaType: stored.ref.mediaType })
      }

      const imageBytes = images.map((image) => image.data)
      const cached = deps.answerCache.get(imageBytes, question, config.model)
      if (cached !== undefined) return cached

      const result = await callVision({
        baseURL: config.baseURL,
        apiKey: config.apiKey,
        model: config.model,
        question,
        images,
        prompt: config.captionPrompt,
        timeoutMs: config.timeoutMs,
        signal: exec.signal,
      })
      if (result.ok) {
        deps.answerCache.set(imageBytes, question, config.model, result.text)
        // 成功答案同时进图片描述记忆：后续请求直接内嵌描述，省一次视觉调用。
        for (const id of ids) deps.imageMemory.set(id, result.text)
        return result.text
      }
      return JSON.stringify({ ok: false, code: result.kind, retryable: result.retryable, reason: result.reason })
    },
  })
}

/** 供测试与错误提示复用：内容哈希。 */
export { contentHash }
