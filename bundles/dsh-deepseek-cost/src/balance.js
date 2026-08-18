/**
 * dsh-deepseek-cost 余额服务（Host 侧）。
 *
 * 通过 DeepSeek 官方「查询余额」接口获取当前 API Key 账号余额：
 *   GET {baseURL}/user/balance
 *   Authorization: Bearer <DEEPSEEK_API_KEY>
 * 响应形如：
 *   {
 *     "is_available": true,
 *     "balance_infos": [
 *       { "currency": "CNY", "total_balance": "110.00",
 *         "granted_balance": "0.00", "topped_up_balance": "110.00" }
 *     ]
 *   }
 *
 * 该模块不接触密钥存储：API Key 由宿主通过 getApiKey() 每次刷新时解析，
 * 只把结构化余额快照暴露给订阅方（例如桌宠插件），避免密钥进入浏览器或
 * 渲染进程。默认关闭，需用户在设置页打开 balanceEnabled。
 */

export const BALANCE_SERVICE = 'dshDeepseekBalance'
export const DEFAULT_BALANCE_REFRESH_MINUTES = 15
export const DEFAULT_BALANCE_BASE_URL = 'https://api.deepseek.com'
const DEFAULT_TIMEOUT_MS = 10000

function refreshMs(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return DEFAULT_BALANCE_REFRESH_MINUTES * 60_000
  return Math.round(minutes * 60_000)
}

/** 从 DeepSeek 余额响应中取出首个 CNY（缺省第一个）余额信息。 */
export function normalizeBalancePayload(payload) {
  const infos = Array.isArray(payload?.balance_infos) ? payload.balance_infos : []
  if (infos.length === 0) throw new Error('balance response did not include balance_infos')
  const info = infos.find((entry) => entry && entry.currency === 'CNY') ?? infos[0]
  const totalBalance = Number(info?.total_balance)
  if (!Number.isFinite(totalBalance) || totalBalance < 0) {
    throw new Error('balance response contained an invalid total_balance')
  }
  return {
    currency: typeof info.currency === 'string' && info.currency !== '' ? info.currency : 'CNY',
    totalBalance,
    grantedBalance: Number.isFinite(Number(info?.granted_balance)) ? Number(info.granted_balance) : undefined,
    toppedUpBalance: Number.isFinite(Number(info?.topped_up_balance)) ? Number(info.topped_up_balance) : undefined,
  }
}

/**
 * 创建余额服务。
 * @param {object} options
 * @param {() => Promise<string | undefined>} options.getApiKey 解析当前 DeepSeek API Key。
 * @param {string} options.baseUrl DeepSeek API base（缺省官方公开端点）。
 * @param {number} options.refreshMinutes 刷新间隔（分钟）。
 * @param {typeof fetch} [options.fetchImpl] 测试注入用。
 * @param {number} [options.timeoutMs] 单次请求超时。
 * @param {{ warn?: Function, error?: Function }} [options.logger]
 */
export function createBalanceService(options) {
  const state = {
    options,
    snapshot: { status: 'disabled', updatedAt: 0 },
    timer: undefined,
    stopped: false,
    refreshing: false,
  }
  const listeners = new Set()

  const emit = () => {
    const snapshot = state.snapshot
    for (const listener of [...listeners]) {
      try { listener(snapshot) } catch { /* 单个监听器异常不影响其他订阅方 */ }
    }
  }

  const setOptions = (next) => {
    state.options = { ...state.options, ...next }
  }

  const get = () => state.snapshot

  const subscribe = (listener) => {
    listeners.add(listener)
    try { listener(state.snapshot) } catch { /* 订阅即回放当前快照 */ }
    return () => listeners.delete(listener)
  }

  const refresh = async () => {
    if (state.refreshing) return state.snapshot
    state.refreshing = true
    try {
      const apiKey = await state.options.getApiKey()
      if (apiKey === undefined || apiKey === '') {
        state.snapshot = { status: 'unavailable', reason: 'no-api-key', updatedAt: Date.now() }
        emit()
        return state.snapshot
      }
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), state.options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
      timeout.unref?.()
      try {
        const baseUrl = String(state.options.baseUrl ?? DEFAULT_BALANCE_BASE_URL).replace(/\/+$/, '')
        const response = await (state.options.fetchImpl ?? fetch)(baseUrl + '/user/balance', {
          method: 'GET',
          headers: {
            authorization: 'Bearer ' + apiKey,
            accept: 'application/json',
          },
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok) {
          throw new Error('balance request failed: HTTP ' + response.status)
        }
        const payload = await response.json()
        const parsed = normalizeBalancePayload(payload)
        state.snapshot = { status: 'ok', ...parsed, updatedAt: Date.now() }
      } finally {
        clearTimeout(timeout)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      state.options.logger?.warn?.('dsh-deepseek-cost balance refresh failed: ' + message)
      state.snapshot = { status: 'error', reason: message, updatedAt: Date.now() }
    } finally {
      state.refreshing = false
      emit()
    }
    return state.snapshot
  }

  const start = () => {
    if (state.timer !== undefined || state.stopped) return
    void refresh()
    state.timer = setInterval(() => { void refresh() }, refreshMs(state.options.refreshMinutes))
    state.timer.unref?.()
  }

  const stop = () => {
    if (state.timer !== undefined) clearInterval(state.timer)
    state.timer = undefined
    state.snapshot = { status: 'disabled', updatedAt: Date.now() }
    emit()
  }

  const dispose = () => {
    state.stopped = true
    stop()
    listeners.clear()
  }

  return { setOptions, subscribe, refresh, start, stop, dispose, get }
}
