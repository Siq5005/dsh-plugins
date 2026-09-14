/**
 * dsh-workbench client bundle 的右侧列兼容层测试。
 *
 * 背景：上游 0.1.5 把右侧 details 列整体改名为 rightbar——列/槽名 'details'
 * → 'rightbar'，服务方法 layout.openDetails/closeDetails → openRightbar/
 * closeRightbar，旧名被移除而非保留别名。client bundle 必须同时兼容
 * 0.1.2-rc.1（旧名）与 0.1.5+（新名），本测试锁定这两条线。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BUNDLE = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'client.js')

const el = (type, props, children) => ({ type, props: props ?? {}, children })

/** 装载浏览器形态的 client bundle，返回 module.exports。 */
function loadClientBundle() {
  // bundle 在 factory 求值期就调用 injectCss()，需要 document 桩。
  globalThis.document = {
    createElement: () => ({ textContent: '' }),
    head: { appendChild: () => {} },
  }
  const React = {
    createElement: (type, props, ...children) => ({
      type,
      props: props ?? {},
      children: children.length > 1 ? children : children[0],
    }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
  }
  let loaded
  globalThis.window = {
    __ModuleLoader__: {
      load: ({ factory }) => {
        loaded = factory((id) => {
          if (id === 'react') return React
          throw new Error('unexpected require: ' + id)
        })
      },
    },
  }
  new Function(readFileSync(BUNDLE, 'utf8'))()
  assert.ok(loaded, 'bundle 未通过 window.__ModuleLoader__.load 注册')
  return loaded
}

/** 递归收集元素树里所有带 onClick 的节点。 */
function collectClickables(node, out = []) {
  if (node == null || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) collectClickables(child, out)
    return out
  }
  if (node.props && typeof node.props.onClick === 'function') out.push(node)
  collectClickables(node.children, out)
  return out
}

function createMockCtx(layout) {
  const injected = []
  const registered = []
  const slots = {
    inject(name, cb) {
      injected.push(name)
      cb()
      return () => {}
    },
    register(opts, component) {
      registered.push({ opts, component })
      return () => {}
    },
  }
  const ctx = {
    get: (key) => (key === 'slots' ? slots : key === 'layout' ? layout : undefined),
    effect: (fn) => { fn() },
  }
  return { ctx, injected, registered }
}

/** 渲染已注册的头部件并点击「工作台」按钮。 */
function clickHeaderButton(bundle, registered) {
  const header = registered.find((r) => r.opts.name === 'conversation.session.header.utilities')
  assert.ok(header, '未注册会话头部「工作台」按钮槽')
  const element = header.component()
  const button = element.type(element.props)
  button.props.onClick()
}

/** 渲染已注册的右列面板并点击「关闭」按钮。 */
function clickCloseButton(registered, slotName) {
  const panel = registered.find((r) => r.opts.name === slotName)
  assert.ok(panel, '未注册右列面板槽 ' + slotName)
  const element = panel.component({})
  const tree = element.type(element.props)
  const close = collectClickables(tree).find((n) => n.children === '关闭')
  assert.ok(close, '面板树里找不到「关闭」按钮')
  close.props.onClick()
}

test('0.1.5+ 新 API：注册 rightbar 槽并调用 openRightbar/closeRightbar', () => {
  const bundle = loadClientBundle()
  assert.equal(bundle.name, 'dsh-workbench-client')
  assert.deepEqual(bundle.inject, ['slots'])

  const calls = []
  const layout = {
    openRightbar: () => calls.push('openRightbar'),
    closeRightbar: () => calls.push('closeRightbar'),
  }
  const { ctx, injected, registered } = createMockCtx(layout)
  bundle.apply(ctx)

  assert.deepEqual(injected, ['conversation.session.header.utilities', 'rightbar'])
  assert.deepEqual(registered.map((r) => r.opts.name), ['conversation.session.header.utilities', 'rightbar'])
  assert.equal(registered[1].opts.priority, -100)

  clickHeaderButton(bundle, registered)
  clickCloseButton(registered, 'rightbar')
  assert.deepEqual(calls, ['openRightbar', 'closeRightbar'])
})

test('0.1.2-rc.1 旧 API：注册 details 槽并调用 openDetails/closeDetails', () => {
  const bundle = loadClientBundle()
  const calls = []
  const layout = {
    openDetails: () => calls.push('openDetails'),
    closeDetails: () => calls.push('closeDetails'),
  }
  const { ctx, injected, registered } = createMockCtx(layout)
  bundle.apply(ctx)

  assert.deepEqual(injected, ['conversation.session.header.utilities', 'details'])
  assert.deepEqual(registered.map((r) => r.opts.name), ['conversation.session.header.utilities', 'details'])

  clickHeaderButton(bundle, registered)
  clickCloseButton(registered, 'details')
  assert.deepEqual(calls, ['openDetails', 'closeDetails'])
})

test('布局服务缺失：槽名回落 details，点击安全 no-op', () => {
  const bundle = loadClientBundle()
  const calls = []
  // 布局服务缺失：槽名回落 details，但点击必须安全 no-op。
  const { ctx, registered } = createMockCtx(undefined)
  bundle.apply(ctx)
  assert.deepEqual(registered.map((r) => r.opts.name), ['conversation.session.header.utilities', 'details'])
  clickHeaderButton(bundle, registered)
  clickCloseButton(registered, 'details')
  assert.deepEqual(calls, [])
})

test('apply 在缺少 slots 服务时不抛错', () => {
  const bundle = loadClientBundle()
  bundle.apply({ get: () => undefined })
})
