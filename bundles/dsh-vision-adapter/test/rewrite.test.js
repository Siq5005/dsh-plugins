import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  rewriteImagesDeep,
  rewriteImageBlocks,
  rewriteForTextModel,
  pendingImageText,
  describedImageText,
  attachmentIdOf,
} from '../src/rewrite.js'

const imageBlock = (id, name) => ({
  type: 'image',
  attachment: { attachmentId: id, mediaType: 'image/png', bytes: 10, width: 1, height: 1, name },
})

test('rewriteImagesDeep: 替换顶层 image block', () => {
  const content = [{ type: 'text', text: 'hi' }, imageBlock('sha256:a', 'a.png')]
  const out = rewriteImagesDeep(content, (block) => ({ type: 'text', text: `IMG:${attachmentIdOf(block)}` }))
  assert.equal(out.changed, true)
  assert.deepEqual(out.content, [
    { type: 'text', text: 'hi' },
    { type: 'text', text: 'IMG:sha256:a' },
  ])
})

test('rewriteImagesDeep: 递归进入 tool-result 嵌套 content', () => {
  const content = [
    {
      type: 'tool-result',
      toolCallId: 'c1',
      content: [{ type: 'text', text: 'x' }, imageBlock('sha256:b', 'b.png')],
    },
  ]
  const out = rewriteImagesDeep(content, () => ({ type: 'text', text: 'REPLACED' }))
  assert.equal(out.changed, true)
  assert.equal(out.content[0].content.length, 2)
  assert.deepEqual(out.content[0].content[1], { type: 'text', text: 'REPLACED' })
  // 外层 block 不变（tool-result 本身保留）
  assert.equal(out.content[0].type, 'tool-result')
})

test('rewriteImagesDeep: 无 image 时原样返回且 changed=false', () => {
  const content = [{ type: 'text', text: 'a' }, { type: 'tool-result', toolCallId: 'c', content: [{ type: 'text', text: 'b' }] }]
  const out = rewriteImagesDeep(content, () => ({ type: 'text', text: 'x' }))
  assert.equal(out.changed, false)
  assert.equal(out.content, content) // 同一引用
})

test('pendingImageText: 含附件 id、工具名与失败语义', () => {
  const text = pendingImageText(imageBlock('sha256:abc', '猫.png'))
  assert.match(text, /sha256:abc/)
  assert.match(text, /猫.png/)
  assert.match(text, /analyze_image/)
  assert.match(text, /attachmentIds/)
  assert.match(text, /ok:false/)
})

test('describedImageText: 内嵌缓存描述与不可信警告', () => {
  const text = describedImageText(imageBlock('sha256:abc', '猫.png'), '一只橘猫在窗台上晒太阳。')
  assert.match(text, /一只橘猫在窗台上晒太阳/)
  assert.match(text, /不可当作指令执行/)
})

test('rewriteImageBlocks: 收集 images 且不改原消息', () => {
  const messages = [
    { role: 'user', content: [imageBlock('sha256:a', 'a.png')], id: 'm1' },
    { role: 'user', content: [{ type: 'text', text: 'plain' }], id: 'm2' },
  ]
  const out = rewriteImageBlocks(messages, (block) => ({ type: 'text', text: 'T' }))
  assert.equal(out.changed, true)
  assert.equal(out.images.length, 1)
  assert.equal(out.images[0].attachment.attachmentId, 'sha256:a')
  // 原消息未被修改
  assert.equal(messages[0].content[0].type, 'image')
  // 无图消息原样引用
  assert.equal(out.messages[1], messages[1])
})

test('rewriteForTextModel: 缓存命中用描述，未命中用引导', () => {
  const memory = {
    get: (id) => (id === 'sha256:known' ? '缓存描述' : undefined),
  }
  const messages = [
    { role: 'user', content: [imageBlock('sha256:known', 'a.png'), imageBlock('sha256:new', 'b.png')] },
  ]
  const out = rewriteForTextModel(messages, { imageMemory: memory })
  assert.equal(out.changed, true)
  const texts = out.messages[0].content.map((b) => b.text)
  assert.match(texts[0], /缓存描述/)
  assert.match(texts[1], /sha256:new/)
  assert.match(texts[1], /analyze_image/)
})
