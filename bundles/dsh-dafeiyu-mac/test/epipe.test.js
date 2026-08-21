import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HelperProcess } from '../src/helper-process.js'
import { createMessage, CompanionMessageKind } from '../src/protocol.js'

const silent = { info() {}, warn() {}, error() {}, debug() {} }

function waitSpawned(hp, timeoutMs = 10000) {
  const started = Date.now()
  return new Promise((resolvePromise) => {
    const check = () => {
      if (hp.spawned) return resolvePromise()
      if (Date.now() - started > timeoutMs) return resolvePromise()
      setTimeout(check, 20)
    }
    check()
  })
}

test('send swallows a synchronous EPIPE from a closing stdin (race window)', () => {
  const hp = new HelperProcess({}, silent)
  const epipe = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })
  hp.child = {
    stdin: { writable: true, destroyed: false, write() { throw epipe } },
  }
  hp.spawned = true
  hp.hasEverSpawned = true
  assert.doesNotThrow(() => hp.send(createMessage(CompanionMessageKind.STATE, { state: 'IDLE' })))
  assert.equal(hp.child, undefined, 'child should be marked dead on EPIPE')
  assert.equal(hp.spawned, false)
})

test('send after child death must not throw EPIPE or crash the process', async () => {
  // 捕获进程级 uncaught（EPIPE 会从这里冒泡）。
  const uncaught = []
  const onUncaught = (error) => uncaught.push(error)
  process.on('uncaughtException', onUncaught)
  try {
    const hp = new HelperProcess({ headless: true }, silent)
    hp.start()
    await waitSpawned(hp)
    assert.equal(hp.spawned, true)

    // 模拟 helper 意外退出（kill），随即在竞态窗口内 send。
    hp.child.kill('SIGKILL')
    for (let i = 0; i < 20; i += 1) {
      hp.send(createMessage(CompanionMessageKind.STATE, { state: 'IDLE', seq: i }))
    }
    // 等进程真正退出，再 send 若干次（exit 处理路径）。
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200))
    for (let i = 0; i < 20; i += 1) {
      hp.send(createMessage(CompanionMessageKind.STATE, { state: 'IDLE', seq: i }))
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200))

    assert.deepEqual(uncaught, [], `uncaught exceptions: ${uncaught.map((e) => e.message).join('; ')}`)
  } finally {
    process.off('uncaughtException', onUncaught)
  }
})
