import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CompanionReducer, isUserQuestionTool, toolActivity } from '../src/companion-reducer.js'
import { CompanionMessageKind, CompanionState } from '../src/protocol.js'

const session = { header: { id: 's1', cwd: '/work/proj' } }
const subagentSession = { header: { id: 's2', origin: 'subagent', delegationDepth: 1 } }

function runSequence(events) {
  const reducer = new CompanionReducer()
  const outputs = []
  for (const { session: s, event } of events) {
    for (const message of reducer.handle(s, event)) outputs.push(message)
  }
  return outputs
}

test('state flow: turn/start -> tool/call -> tool/result -> turn/end(success)', () => {
  const outputs = runSequence([
    { session, event: { type: 'turn/start', seq: 1 } },
    { session, event: { type: 'tool/call', seq: 2, data: { name: 'bash', message: { source: { callId: 'c1' } } } } },
    { session, event: { type: 'tool/result', seq: 3, data: { callId: 'c1' } } },
    { session, event: { type: 'turn/end', seq: 4, data: { reason: { kind: 'completed' } } } },
  ])
  const states = outputs.filter((m) => m.kind === CompanionMessageKind.STATE)
  assert.deepEqual(states.map((m) => m.state), [
    CompanionState.THINKING,
    CompanionState.WORKING,
    CompanionState.THINKING,
  ])
  const pulses = outputs.filter((m) => m.kind === CompanionMessageKind.PULSE)
  assert.equal(pulses.length, 1)
  assert.equal(pulses[0].state, CompanionState.SUCCESS)
  // 成功后通过 PULSE 的 resumeState 回落到 IDLE（不发单独的 IDLE STATE）
  assert.equal(pulses[0].resumeState, CompanionState.IDLE)
})

test('waiting state on user-question tool and resume on user/message', () => {
  const outputs = runSequence([
    { session, event: { type: 'turn/start', seq: 1 } },
    { session, event: {
      type: 'tool/call', seq: 2,
      data: { name: 'ask_user_question', arguments: '{"questions":[{"question":"要继续吗？"}]}', message: { source: { callId: 'q1' } } },
    } },
    { session, event: { type: 'user/message', seq: 3, data: { callId: 'q1' } } },
  ])
  const states = outputs.filter((m) => m.kind === CompanionMessageKind.STATE)
  assert.deepEqual(states.map((m) => m.state), [
    CompanionState.THINKING,
    CompanionState.WAITING,
    CompanionState.THINKING,
  ])
  // 提问工具触发 QUESTION 消息（问题文本下发给桌宠气泡）。
  const question = outputs.find((m) => m.kind === CompanionMessageKind.QUESTION)
  assert.ok(question, 'expected a QUESTION message')
  assert.equal(question.question, '要继续吗？')
})

test('todo/write emits TASK with progress', () => {
  const reducer = new CompanionReducer()
  reducer.handle(session, { type: 'turn/start', seq: 1 })
  const outputs = reducer.handle(session, {
    type: 'todo/write', seq: 2,
    data: { todos: [
      { content: '调研', status: 'completed' },
      { content: '实现', status: 'in_progress' },
      { content: '验证', status: 'pending' },
    ] },
  })
  const task = outputs.find((m) => m.kind === CompanionMessageKind.TASK)
  assert.ok(task, 'expected a TASK message')
  assert.match(task.task, /实现/)
  assert.deepEqual(task.progress, { completed: 1, total: 3, current: 2 })
})

test('subagents are ignored by default and can be included', () => {
  const reducer = new CompanionReducer()
  const outputs = reducer.handle(subagentSession, { type: 'turn/start', seq: 1 })
  assert.equal(outputs.length, 0)

  const reducer2 = new CompanionReducer({ includeSubagents: true })
  const outputs2 = reducer2.handle(subagentSession, { type: 'turn/start', seq: 1 })
  assert.equal(outputs2.length, 1)
  assert.equal(outputs2[0].state, CompanionState.THINKING)
})

test('most urgent session wins across sessions', () => {
  const reducer = new CompanionReducer()
  reducer.handle(session, { type: 'turn/start', seq: 1 })
  const waiting = { header: { id: 'w1', cwd: '/work/other' } }
  const outputs = reducer.handle(waiting, {
    type: 'tool/call', seq: 2, data: { name: 'ask_user_question', message: { source: { callId: 'q1' } } },
  })
  assert.equal(outputs[0].state, CompanionState.WAITING)
  assert.equal(outputs[0].sessionId, 'w1')
})

test('approval/asked enters WAITING and approval/decided resumes', () => {
  const reducer = new CompanionReducer()
  reducer.handle(session, { type: 'turn/start', seq: 1 })
  reducer.handle(session, {
    type: 'tool/call', seq: 2, data: { name: 'bash', message: { source: { callId: 'c1' } } },
  })
  const asked = reducer.handle(session, {
    type: 'approval/asked', seq: 3, data: { id: 'a1', toolName: 'bash' },
  })
  const state = asked.find((m) => m.kind === CompanionMessageKind.STATE)
  assert.equal(state.state, CompanionState.WAITING)
  assert.equal(state.stage, '等待审批')

  // id 不匹配：不处理
  const wrongId = reducer.handle(session, { type: 'approval/decided', seq: 4, data: { id: 'other' } })
  assert.equal(wrongId.length, 0)

  // id 匹配：恢复工作状态（bash 工具仍在 openTools → WORKING）
  const decided = reducer.handle(session, { type: 'approval/decided', seq: 5, data: { id: 'a1' } })
  const resumed = decided.filter((m) => m.kind === CompanionMessageKind.STATE)
  assert.equal(resumed.at(-1).state, CompanionState.WORKING)
})

test('user-question tool names match token-level; ordinary tools do not', () => {
  for (const name of ['ask_user_question', 'request_approval', 'approval_from_user', 'user_confirmation', 'ask_for_input']) {
    assert.equal(isUserQuestionTool(name), true, `${name} should match`)
  }
  // token 级匹配的改进：普通工具名不再被误判为等待用户。
  for (const name of ['approve_action', 'permission_check', 'authorize', 'code_review', 'allowlist_files', 'bash']) {
    assert.equal(isUserQuestionTool(name), false, `${name} should NOT match`)
  }
})

test('disposeSession removes the session record', () => {
  const reducer = new CompanionReducer()
  reducer.handle(session, { type: 'turn/start', seq: 1 })
  assert.equal(reducer.sessions.size, 1)
  reducer.disposeSession(session)
  assert.equal(reducer.sessions.size, 0)
})

test('toolActivity classifies tool names', () => {
  assert.equal(toolActivity('web_search'), 'searching')
  assert.equal(toolActivity('bash'), 'commanding')
  assert.equal(toolActivity('edit'), 'editing')
  assert.equal(toolActivity('npm test'), 'testing')
  assert.equal(toolActivity('anything_else'), 'using-tool')
})
