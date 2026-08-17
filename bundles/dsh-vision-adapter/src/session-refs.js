/**
 * 从会话事件日志解析 durable image attachment 引用（纯函数，可独立测试）。
 *
 * analyze_image 工具收到模型传来的 attachmentId（如 sha256:...）后，需要拿到
 * 带完整元数据的 ImageAttachmentRef 才能调 attachments.readImage(ref) 取回字节
 * 并校验。事件日志是唯一能看到每张进入对话的图的地方（含 host 持久化的用户
 * 上传图与 read_image 等工具重传图）。
 * @module dsh-vision-adapter/session-refs
 */

import { rewriteImagesDeep } from './rewrite.js'

/**
 * 收集会话事件日志中出现的所有 attachment 引用（按首次出现顺序去重）。
 * 覆盖 user/message（消息直接携带）、assistant/message 与 tool/result（嵌套在
 * data.message 下），并下钻 tool-result 嵌套 content。
 * @param {Array<object>} events - session.events（或形状相同的数组）。
 * @returns {Array<object>} ImageAttachmentRef 列表
 */
export function collectEventAttachmentRefs(events) {
  const refs = []
  const seen = new Set()
  for (const event of events ?? []) {
    if (event === null || typeof event !== 'object' || event.data === undefined) continue
    let message
    if (event.type === 'user/message') {
      message = event.data
    } else if (event.type === 'assistant/message' || event.type === 'tool/result') {
      message = event.data && event.data.message
    } else {
      continue
    }
    if (message === null || typeof message !== 'object' || !Array.isArray(message.content)) continue
    rewriteImagesDeep(message.content, (block) => {
      const attachment = block && block.attachment
      if (attachment && attachment.attachmentId && !seen.has(String(attachment.attachmentId))) {
        seen.add(String(attachment.attachmentId))
        refs.push(attachment)
      }
      return block
    })
  }
  return refs
}

/**
 * 在会话事件日志中按 attachmentId 查找引用。
 * @param {Array<object>} events - session.events
 * @param {string} id - 形如 sha256:... 的 attachmentId。
 * @returns {object | undefined} ImageAttachmentRef
 */
export function lookupAttachmentRef(events, id) {
  const wanted = String(id)
  if (wanted === '' || wanted === 'unknown') return undefined
  return collectEventAttachmentRefs(events).find(
    (ref) => String(ref.attachmentId) === wanted,
  )
}
