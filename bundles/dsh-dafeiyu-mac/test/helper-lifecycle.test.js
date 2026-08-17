import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { encodeMessage, createMessage, CompanionMessageKind } from '../src/protocol.js'

const here = dirname(fileURLToPath(import.meta.url))
const helperPath = resolve(here, '..', 'runtime', 'helper.py')

function startHeadless() {
  const command = process.env.DSH_DAFEIYU_PYTHON || (process.platform === 'win32' ? 'py' : 'python3')
  // `-3` 是 Windows `py` 启动器的参数；macOS 的 python3 直接接脚本路径。
  const args = process.platform === 'win32' ? ['-3', helperPath, '--headless'] : [helperPath, '--headless']
  const child = spawn(command, args, {
    cwd: resolve(here, '..'),
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const replies = []
  createInterface({ input: child.stdout }).on('line', (line) => {
    if (line.trim()) replies.push(JSON.parse(line))
  })
  return { child, replies }
}

function waitFor(predicate, timeoutMs = 10000) {
  const started = Date.now()
  return new Promise((resolvePromise, reject) => {
    const check = () => {
      if (predicate()) return resolvePromise()
      if (Date.now() - started > timeoutMs) return reject(new Error('timed out waiting for condition'))
      setTimeout(check, 20)
    }
    check()
  })
}

test('headless helper: ready handshake, ping/pong, shutdown exits cleanly', async () => {
  const { child, replies } = startHeadless()
  await waitFor(() => replies.some((r) => r.kind === 'ready'))

  child.stdin.write(encodeMessage(createMessage(CompanionMessageKind.PING)))
  await waitFor(() => replies.some((r) => r.kind === 'pong'))

  child.stdin.write(encodeMessage(createMessage(CompanionMessageKind.STATE, {
    state: 'THINKING', phase: 'thinking', stage: '分析阶段', message: '正在认真想下一步呢',
  })))
  child.stdin.write(encodeMessage(createMessage(CompanionMessageKind.SHUTDOWN, { reason: 'test' })))
  child.stdin.end()

  const code = await new Promise((resolvePromise) => {
    child.once('exit', (exitCode) => resolvePromise(exitCode))
  })
  assert.equal(code, 0)
  const kinds = replies.map((r) => r.kind)
  assert.ok(kinds.includes('ready'))
  assert.ok(kinds.includes('pong'))
})

test('headless helper: closes when stdin ends', async () => {
  const { child, replies } = startHeadless()
  await waitFor(() => replies.some((r) => r.kind === 'ready'))
  child.stdin.end()
  const code = await new Promise((resolvePromise) => {
    child.once('exit', (exitCode) => resolvePromise(exitCode))
  })
  assert.equal(code, 0)
})
