import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BALANCE_SERVICE,
  createBalanceService,
  normalizeBalancePayload,
} from '../src/balance.js'

function fakeFetch(payload, ok = true, status = 200) {
  return async () => ({
    ok,
    status,
    json: async () => payload,
  })
}

test('normalizeBalancePayload: 取 CNY 并解析余额', () => {
  const parsed = normalizeBalancePayload({
    is_available: true,
    balance_infos: [
      { currency: 'USD', total_balance: '1.00' },
      { currency: 'CNY', total_balance: '110.00', granted_balance: '0.00', topped_up_balance: '110.00' },
    ],
  })
  assert.equal(parsed.currency, 'CNY')
  assert.equal(parsed.totalBalance, 110)
  assert.equal(parsed.grantedBalance, 0)
  assert.equal(parsed.toppedUpBalance, 110)
})

test('normalizeBalancePayload: 缺省取第一个，非法余额拒绝', () => {
  assert.equal(normalizeBalancePayload({ balance_infos: [{ currency: 'CNY', total_balance: '3.5' }] }).totalBalance, 3.5)
  assert.throws(() => normalizeBalancePayload({}), /did not include balance_infos/)
  assert.throws(() => normalizeBalancePayload({ balance_infos: [{ currency: 'CNY', total_balance: 'oops' }] }), /invalid total_balance/)
})

test('createBalanceService: 订阅回放 disabled，刷新成功后广播 ok 快照', async () => {
  const service = createBalanceService({
    getApiKey: async () => 'test-key',
    baseUrl: 'https://api.deepseek.com',
    refreshMinutes: 60,
    fetchImpl: fakeFetch({ balance_infos: [{ currency: 'CNY', total_balance: '12.34' }] }),
  })
  const seen = []
  const off = service.subscribe((snapshot) => seen.push(snapshot))
  assert.equal(seen.length, 1)
  assert.equal(seen[0].status, 'disabled')
  await service.refresh()
  assert.equal(service.get().status, 'ok')
  assert.equal(service.get().totalBalance, 12.34)
  assert.equal(seen.at(-1).status, 'ok')
  off()
})

test('createBalanceService: 无 API Key 快照为 unavailable', async () => {
  const service = createBalanceService({
    getApiKey: async () => undefined,
    baseUrl: 'https://api.deepseek.com',
    refreshMinutes: 60,
    fetchImpl: fakeFetch({}),
  })
  await service.refresh()
  assert.equal(service.get().status, 'unavailable')
  assert.equal(service.get().reason, 'no-api-key')
})

test('createBalanceService: 请求失败快照为 error，不抛出', async () => {
  const service = createBalanceService({
    getApiKey: async () => 'test-key',
    baseUrl: 'https://api.deepseek.com',
    refreshMinutes: 60,
    fetchImpl: fakeFetch({}, false, 401),
    logger: console,
  })
  await service.refresh()
  assert.equal(service.get().status, 'error')
  assert.match(service.get().reason, /HTTP 401/)
})

test('createBalanceService: stop 回到 disabled 并清掉订阅', () => {
  const service = createBalanceService({
    getApiKey: async () => 'test-key',
    baseUrl: 'https://api.deepseek.com',
    refreshMinutes: 60,
    fetchImpl: fakeFetch({ balance_infos: [{ currency: 'CNY', total_balance: '1' }] }),
  })
  let latest = service.get()
  const off = service.subscribe((snapshot) => { latest = snapshot })
  service.stop()
  assert.equal(latest.status, 'disabled')
  off()
  service.dispose()
})

test('BALANCE_SERVICE 名称与桌宠约定一致', () => {
  assert.equal(BALANCE_SERVICE, 'dshDeepseekBalance')
})
