// D-020 A7b：Web 客户端设置卡片注册的故障隔离（对照上游 0.1.0-alpha.15）：
// 槽位契约再变时只丢大肥鱼卡片，不让整个 WebUI 加载失败。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const clientSource = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

const ReactStub = {
  createElement: (...args) => ({ type: args[0], props: args[1] }),
  useEffect: () => {},
  useRef: (value) => ({ current: value }),
  useState: (value) => [value, () => {}],
}

// lib/client.js 是浏览器端 module-loader 脚本：桩掉 window.__ModuleLoader__ 与 react，
// 取出插件对象（name / inject / apply）。
function loadClientPlugin() {
  let plugin
  const windowStub = {
    __ModuleLoader__: {
      load({ factory }) {
        plugin = factory((name) => {
          if (name === 'react') return ReactStub
          throw new Error(`unexpected require: ${name}`)
        })
      },
    },
  }
  new Function('window', clientSource)(windowStub)
  return plugin
}

function captureWarnings(run) {
  const warnings = []
  const original = console.warn
  console.warn = (...args) => warnings.push(args.join(' '))
  try {
    run()
  } finally {
    console.warn = original
  }
  return warnings
}

test('client: slot injection failure is isolated and warned', () => {
  const plugin = loadClientPlugin()
  const warnings = captureWarnings(() => {
    const ctx = { slots: { inject() { throw new Error('slot contract changed') }, register() {} } }
    assert.doesNotThrow(() => plugin.apply(ctx), '槽位注入抛错不得逃出客户端插件')
  })
  assert.ok(
    warnings.some((text) => text.includes('settings card')),
    `应记录隔离告警，实际：${warnings.join(' | ')}`,
  )
})

test('client: register failure inside the inject callback is isolated and warned', () => {
  const plugin = loadClientPlugin()
  const warnings = captureWarnings(() => {
    const ctx = { slots: { inject(name, cb) { cb() }, register() { throw new Error('register boom') } } }
    assert.doesNotThrow(() => plugin.apply(ctx), '卡片注册抛错不得逃出客户端插件')
  })
  assert.ok(
    warnings.some((text) => text.includes('settings card')),
    `应记录隔离告警，实际：${warnings.join(' | ')}`,
  )
})

test('client: normal registration still registers the keyed settings card', () => {
  const plugin = loadClientPlugin()
  const registered = []
  const ctx = {
    slots: {
      inject(name, cb) { cb() },
      register(options, component) {
        registered.push({ options, component })
        return () => {}
      },
    },
  }
  plugin.apply(ctx)
  assert.equal(registered.length, 1)
  assert.equal(registered[0].options.name, 'settings.plugin.item')
  assert.equal(registered[0].options.key, 'dsh-dafeiyu-mac')
  assert.equal(typeof registered[0].component, 'function')
})
