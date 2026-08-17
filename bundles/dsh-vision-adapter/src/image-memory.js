/**
 * 视觉结果缓存（纯函数，可独立测试）。
 *
 * 两级缓存，均按"图片内容"而非会话 id 键控：
 *   - 图片描述记忆（imageMemory）：attachmentId -> 描述文本。重写模型输入时，
 *     已描述过的图直接用缓存文本，避免重复调用视觉端点。
 *   - 问答答案缓存（answerCache）：内容哈希 + 问题 -> 答案文本。同一张图同一
 *     个问题的 analyze_image 调用直接命中，不重复花钱。
 * @module dsh-vision-adapter/image-memory
 */

import { createHash } from 'node:crypto'

/**
 * 小 LRU 缓存（可设 TTL）。
 * @param {number} maxEntries
 * @param {number} [ttlMs=0] - 0 表示不过期。
 */
export function createLruCache(maxEntries, ttlMs = 0) {
  const entries = new Map()
  return {
    get(key) {
      const entry = entries.get(key)
      if (entry === undefined) return undefined
      if (ttlMs > 0 && entry.expiresAt <= Date.now()) {
        entries.delete(key)
        return undefined
      }
      entries.delete(key)
      entries.set(key, entry)
      return entry.value
    },
    set(key, value) {
      if (value === undefined) return
      if (entries.has(key)) entries.delete(key)
      entries.set(key, { value, expiresAt: ttlMs > 0 ? Date.now() + ttlMs : Infinity })
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value
        entries.delete(oldest)
      }
    },
    get size() {
      return entries.size
    },
  }
}

/**
 * 图片描述记忆：attachmentId -> 描述文本（LRU，无 TTL——同一会话内图片内容不变）。
 * @param {number} [maxEntries=500]
 */
export function createImageMemory(maxEntries = 500) {
  const cache = createLruCache(maxEntries)
  return {
    get(attachmentId) {
      return cache.get(String(attachmentId))
    },
    set(attachmentId, description) {
      cache.set(String(attachmentId), description)
    },
    get size() {
      return cache.size
    },
  }
}

/**
 * 图片内容哈希：对一组图片字节（顺序敏感）做 sha256，用于问答缓存键。
 * @param {Array<Uint8Array|Buffer>} images
 * @returns {string}
 */
export function contentHash(images) {
  const hash = createHash('sha256')
  for (const data of images) {
    const bytes = Buffer.from(data)
    hash.update(String(bytes.length))
    hash.update(bytes)
  }
  return hash.digest('hex')
}

/**
 * analyze_image 问答答案缓存：内容哈希+问题 -> 答案（LRU + TTL）。
 * @param {number} [maxEntries=500]
 * @param {number} [ttlMs=6*60*60*1000]
 */
export function createAnswerCache(maxEntries = 500, ttlMs = 6 * 60 * 60 * 1000) {
  const cache = createLruCache(maxEntries, ttlMs)
  return {
    get(images, question, model) {
      return cache.get(answerKey(images, question, model))
    },
    set(images, question, model, text) {
      cache.set(answerKey(images, question, model), text)
    },
    get size() {
      return cache.size
    },
  }
}

function answerKey(images, question, model) {
  return `${contentHash(images)}\u0000${String(question)}\u0000${String(model)}`
}
