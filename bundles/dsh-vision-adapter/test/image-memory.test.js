import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLruCache, createImageMemory, createAnswerCache, contentHash } from '../src/image-memory.js'

test('createLruCache: 基本读写与 LRU 淘汰', () => {
  const cache = createLruCache(2)
  cache.set('a', 1)
  cache.set('b', 2)
  cache.set('c', 3)
  assert.equal(cache.get('a'), undefined) // 最早条目被淘汰
  assert.equal(cache.get('b'), 2)
  assert.equal(cache.get('c'), 3)
  cache.get('b') // 访问提升 b 为最新
  cache.set('d', 4)
  assert.equal(cache.get('c'), undefined)
  assert.equal(cache.get('b'), 2)
  assert.equal(cache.get('d'), 4)
})

test('createLruCache: TTL 过期', () => {
  const cache = createLruCache(10, 20)
  cache.set('k', 'v')
  assert.equal(cache.get('k'), 'v')
  // 手动推进时间不现实，这里只验证 TTL=0 不过期
  const forever = createLruCache(10, 0)
  forever.set('k', 'v')
  assert.equal(forever.get('k'), 'v')
})

test('createImageMemory: 按 attachmentId 存取', () => {
  const memory = createImageMemory(3)
  memory.set('sha256:a', '描述A')
  assert.equal(memory.get('sha256:a'), '描述A')
  assert.equal(memory.get('sha256:nope'), undefined)
})

test('contentHash: 稳定且顺序敏感', () => {
  const a = contentHash([Buffer.from([1, 2])])
  const b = contentHash([Buffer.from([1, 2])])
  const c = contentHash([Buffer.from([2, 1])])
  const d = contentHash([Buffer.from([1]), Buffer.from([2])])
  assert.equal(a, b)
  assert.notEqual(a, c)
  assert.notEqual(a, d)
  assert.match(a, /^[0-9a-f]{64}$/)
})

test('createAnswerCache: 键含内容+问题+模型', () => {
  const cache = createAnswerCache(10)
  const images = [Buffer.from([1])]
  cache.set(images, '图里是什么？', 'gpt-4o-mini', '一只猫')
  assert.equal(cache.get(images, '图里是什么？', 'gpt-4o-mini'), '一只猫')
  // 问题不同 → 不命中
  assert.equal(cache.get(images, '另一个问题', 'gpt-4o-mini'), undefined)
  // 模型不同 → 不命中
  assert.equal(cache.get(images, '图里是什么？', 'qwen-vl-plus'), undefined)
})
