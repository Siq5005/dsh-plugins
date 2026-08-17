import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collectEventAttachmentRefs, lookupAttachmentRef } from '../src/session-refs.js'

const ref = (id, name) => ({
  attachmentId: id,
  mediaType: 'image/png',
  bytes: 10,
  width: 1,
  height: 1,
  ...(name ? { name } : {}),
})

function event(type, data) {
  return { type, seq: 0, data }
}

test('collectEventAttachmentRefs: 覆盖 user/message 与 tool/result 嵌套', () => {
  const events = [
    event('user/message', {
      role: 'user',
      content: [{ type: 'text', text: '看这张' }, { type: 'image', attachment: ref('sha256:a', 'a.png') }],
      source: { kind: 'user' },
    }),
    event('assistant/message', {
      message: { role: 'assistant', content: [{ type: 'image', attachment: ref('sha256:b') }], source: {} },
    }),
    event('tool/result', {
      message: {
        role: 'user',
        content: [{
          type: 'tool-result',
          toolCallId: 'c1',
          content: [{ type: 'image', attachment: ref('sha256:c') }],
        }],
        source: {},
      },
    }),
    event('turn/start', { turn: 1 }),
  ]
  const refs = collectEventAttachmentRefs(events)
  assert.deepEqual(refs.map((r) => r.attachmentId), ['sha256:a', 'sha256:b', 'sha256:c'])
})

test('collectEventAttachmentRefs: 去重', () => {
  const events = [
    event('user/message', {
      role: 'user',
      content: [{ type: 'image', attachment: ref('sha256:x') }],
      source: { kind: 'user' },
    }),
    event('user/message', {
      role: 'user',
      content: [{ type: 'image', attachment: ref('sha256:x') }],
      source: { kind: 'user' },
    }),
  ]
  assert.equal(collectEventAttachmentRefs(events).length, 1)
})

test('lookupAttachmentRef: 命中与未命中', () => {
  const events = [
    event('user/message', {
      role: 'user',
      content: [{ type: 'image', attachment: ref('sha256:abc', '猫.png') }],
      source: { kind: 'user' },
    }),
  ]
  const hit = lookupAttachmentRef(events, 'sha256:abc')
  assert.equal(hit.attachmentId, 'sha256:abc')
  assert.equal(hit.name, '猫.png')
  assert.equal(lookupAttachmentRef(events, 'sha256:nope'), undefined)
  assert.equal(lookupAttachmentRef(events, 'unknown'), undefined)
  assert.equal(lookupAttachmentRef(events, ''), undefined)
})
