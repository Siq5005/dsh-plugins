import { test } from 'node:test'
import assert from 'node:assert/strict'
import { balanceMessage, BALANCE_SERVICE, CompanionMessageKind } from '../src/index.js'

test('balance service name matches cost plugin contract', () => {
  assert.equal(BALANCE_SERVICE, 'dshDeepseekBalance')
})

test('balanceMessage formats ok snapshot as a balance bubble', () => {
  const message = balanceMessage({
    status: 'ok',
    totalBalance: 12.3,
    currency: 'CNY',
    updatedAt: new Date('2026-08-18T06:30:00').getTime(),
  })
  assert.equal(message.kind, CompanionMessageKind.BALANCE)
  assert.equal(message.status, 'ok')
  assert.match(message.message, /余额 ¥12\.3/)
  assert.match(message.detail, /DeepSeek 账号余额 · CNY/)
})

test('balanceMessage clears the bubble for non-ok snapshots', () => {
  for (const status of ['disabled', 'unavailable', 'error']) {
    const message = balanceMessage({ status })
    assert.equal(message.kind, CompanionMessageKind.BALANCE)
    assert.equal(message.status, status)
    assert.equal(message.message, '')
    assert.equal(message.detail, '')
  }
})
