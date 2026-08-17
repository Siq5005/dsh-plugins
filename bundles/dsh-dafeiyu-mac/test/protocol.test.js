import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CompanionMessageKind,
  CompanionState,
  assertCompanionMessage,
  createMessage,
  encodeMessage,
} from '../src/protocol.js'

test('createMessage stamps protocol version, kind and timestamp', () => {
  const message = createMessage(CompanionMessageKind.STATE, { state: CompanionState.IDLE })
  assert.equal(message.protocolVersion, 1)
  assert.equal(message.kind, 'state')
  assert.equal(typeof message.timestamp, 'number')
  assert.equal(message.state, 'IDLE')
})

test('createMessage rejects unknown kind', () => {
  assert.throws(() => createMessage('bogus'), /Unknown companion message kind/)
})

test('assertCompanionMessage accepts valid state and rejects unknown state', () => {
  const ok = createMessage(CompanionMessageKind.STATE, { state: CompanionState.WORKING })
  assert.doesNotThrow(() => assertCompanionMessage(ok))
  const bad = createMessage(CompanionMessageKind.STATE, { state: 'FLYING' })
  assert.throws(() => assertCompanionMessage(bad), /Unknown companion state/)
})

test('encodeMessage emits a single JSON line', () => {
  const line = encodeMessage(createMessage(CompanionMessageKind.PING))
  assert.equal(line.endsWith('\n'), true)
  const parsed = JSON.parse(line)
  assert.equal(parsed.kind, 'ping')
  assert.equal(parsed.protocolVersion, 1)
})
