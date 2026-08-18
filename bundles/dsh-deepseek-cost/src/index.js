/**
 * dsh-deepseek-cost 插件入口（Host 侧）。
 *
 * 职责：
 *   1. 注册 `tokenCost` 会话投影——按模型 × 高峰/空闲时段累计当前对话的
 *      token 用量（未缓存输入 / 缓存命中输入 / 缓存写入输入 / 输出）。
 *      投影只存纯 token 事实（随日志重放，压缩/重启后依然准确），价格由
 *      浏览器端按设置即时折算，改价无需重启、不丢累计。
 *   2. 注册 `dsh-deepseek-cost` 设置命名空间与本地配置端点
 *      `/plugins/dsh-deepseek-cost/config`：DeepSeek 官方模型自动使用官方
 *      默认定价（只读），其他模型由用户在「费用统计」设置页填写价格。
 *
 * yml 配置（cordis.patch.yml 的 config，改配置需重启生效）：
 *   - enabled: 是否启用（默认 true）
 *   - models: [{ id, name?, cacheMiss, cacheHit, output }] 预置的自定义模型
 *     flat 三桶价（每百万 tokens 元）；设置页可 live 修改
 */

import Schema from '@deepseek-ai/schemastery'
import {
  BALANCE_SERVICE,
  DEFAULT_BALANCE_BASE_URL,
  DEFAULT_BALANCE_REFRESH_MINUTES,
  createBalanceService,
} from './balance.js'
import { createTokenCostProjection } from './cost-projection.js'
import { DEFAULT_PRICES } from './pricing.js'

export const name = 'dsh-deepseek-cost'
export const CONFIG_ENDPOINT = '/plugins/dsh-deepseek-cost/config'

const customModelShape = Schema.object({
  id: Schema.string().required().description('模型 id（如 gpt-4o）'),
  name: Schema.string().description('展示名（缺省用 id）'),
  cacheMiss: Schema.number().min(0).description('未缓存输入（每百万 tokens，元）'),
  cacheHit: Schema.number().min(0).description('缓存命中输入（每百万 tokens，元）'),
  output: Schema.number().min(0).description('输出（每百万 tokens，元）'),
})

export const Config = Schema.object({
  enabled: Schema.boolean().default(true).description('启用当前对话费用统计'),
  models: Schema.array(customModelShape).default([])
    .description('非 DeepSeek 官方模型的 flat 三桶价（每百万 tokens 元），可在设置页修改'),
  balanceEnabled: Schema.boolean().default(false)
    .description('获取 DeepSeek 账号余额并暴露给桌宠等订阅方（需配置 DEEPSEEK_API_KEY）'),
  balanceRefreshMinutes: Schema.number().min(1).max(1440).step(1).default(DEFAULT_BALANCE_REFRESH_MINUTES)
    .description('余额刷新间隔（分钟）'),
  balanceBaseUrl: Schema.string()
    .description('余额接口 base URL；缺省用 DEEPSEEK_BASE_URL 或官方公开端点'),
}).description('按 DeepSeek 官方定价统计当前对话的 token 用量与累计费用')

const defaults = Object.freeze({
  enabled: true,
  models: [],
  balanceEnabled: false,
  balanceRefreshMinutes: DEFAULT_BALANCE_REFRESH_MINUTES,
  balanceBaseUrl: undefined,
})

function publicConfig(config = {}) {
  return {
    enabled: config.enabled ?? defaults.enabled,
    models: Array.isArray(config.models) ? config.models : defaults.models,
    balanceEnabled: config.balanceEnabled ?? defaults.balanceEnabled,
    balanceRefreshMinutes: config.balanceRefreshMinutes ?? defaults.balanceRefreshMinutes,
    balanceBaseUrl: config.balanceBaseUrl ?? defaults.balanceBaseUrl,
  }
}

function localSettingsScope(value) {
  return {
    get: () => value,
    update: async () => {},
    watch: () => () => {},
  }
}

function jsonResponse(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function isLoopback(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/**
 * 校验并清洗 PATCH 请求体（enabled / models / balance 相关字段）。
 * @param {unknown} value
 * @returns {object} 清洗后的补丁
 */
export function sanitizeConfigPatch(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('patch must be an object')
  }
  const patch = {}
  const ALLOWED = new Set(['enabled', 'models', 'balanceEnabled', 'balanceRefreshMinutes', 'balanceBaseUrl'])
  for (const key of Object.keys(value)) {
    if (!ALLOWED.has(key)) throw new Error(`patch contains an unknown setting: ${key}`)
  }
  if (value.enabled !== undefined) {
    if (typeof value.enabled !== 'boolean') throw new Error('enabled must be a boolean')
    patch.enabled = value.enabled
  }
  if (value.models !== undefined) {
    patch.models = sanitizeModels(value.models)
  }
  if (value.balanceEnabled !== undefined) {
    if (typeof value.balanceEnabled !== 'boolean') throw new Error('balanceEnabled must be a boolean')
    patch.balanceEnabled = value.balanceEnabled
  }
  if (value.balanceRefreshMinutes !== undefined) {
    const minutes = value.balanceRefreshMinutes
    if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 1 || minutes > 1440 || !Number.isInteger(minutes)) {
      throw new Error('balanceRefreshMinutes must be an integer between 1 and 1440')
    }
    patch.balanceRefreshMinutes = minutes
  }
  if (value.balanceBaseUrl !== undefined) {
    if (typeof value.balanceBaseUrl !== 'string' || value.balanceBaseUrl.trim() === '') {
      throw new Error('balanceBaseUrl must be a non-empty string')
    }
    let parsed
    try { parsed = new URL(value.balanceBaseUrl) } catch { parsed = null }
    if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('balanceBaseUrl must be an http(s) URL')
    }
    patch.balanceBaseUrl = value.balanceBaseUrl.trim().replace(/\/+$/, '')
  }
  return patch
}

function sanitizeModels(value) {
  if (!Array.isArray(value)) throw new Error('models must be an array')
  return value.map((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`models[${index}] must be an object`)
    }
    const id = entry.id
    if (typeof id !== 'string' || id.trim() === '') {
      throw new Error(`models[${index}].id must be a non-empty string`)
    }
    const rates = {}
    for (const key of ['cacheMiss', 'cacheHit', 'output']) {
      const num = entry[key]
      if (typeof num !== 'number' || !Number.isFinite(num) || num < 0) {
        throw new Error(`models[${index}].${key} must be a non-negative number`)
      }
      rates[key] = num
    }
    const cleaned = { id: id.trim(), ...rates }
    if (typeof entry.name === 'string' && entry.name.trim() !== '') {
      cleaned.name = entry.name.trim()
    }
    return cleaned
  })
}

/** 配置端点的 GET 载荷：当前设置 + 官方默认定价（只读）。 */
export function configPayload(settings) {
  const value = settings.get()
  return {
    enabled: value.enabled !== false,
    models: value.models ?? [],
    balanceEnabled: value.balanceEnabled ?? defaults.balanceEnabled,
    balanceRefreshMinutes: value.balanceRefreshMinutes ?? defaults.balanceRefreshMinutes,
    balanceBaseUrl: value.balanceBaseUrl ?? defaults.balanceBaseUrl,
    defaults: DEFAULT_PRICES,
  }
}

export function createConfigHandler(settings) {
  return async (req, res) => {
    if (!isLoopback(req.socket?.remoteAddress)) {
      jsonResponse(res, 403, { error: 'local access only' })
      return
    }
    const origin = req.headers?.origin
    if (origin) {
      let originHost
      try { originHost = new URL(origin).host } catch {}
      if (!originHost || originHost !== req.headers.host) {
        jsonResponse(res, 403, { error: 'origin mismatch' })
        return
      }
    }
    if (req.method === 'GET') {
      jsonResponse(res, 200, configPayload(settings))
      return
    }
    if (req.method !== 'PATCH') {
      jsonResponse(res, 405, { error: 'method not allowed' })
      return
    }
    try {
      const chunks = []
      let bytes = 0
      for await (const chunk of req) {
        bytes += chunk.length
        if (bytes > 64 * 1024) throw new Error('request body is too large')
        chunks.push(chunk)
      }
      const patch = sanitizeConfigPatch(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      await settings.update(patch)
      jsonResponse(res, 200, configPayload(settings))
    } catch (error) {
      jsonResponse(res, 400, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}

/** 通过 DSH 凭据服务解析 DEEPSEEK_API_KEY；无服务时回退环境变量。 */
async function resolveDeepseekApiKey(ctx) {
  const credentials = typeof ctx.get === 'function' ? ctx.get('credentials') : undefined
  if (credentials !== undefined && typeof credentials.resolve === 'function') {
    const hit = await credentials.resolve('DEEPSEEK_API_KEY')
    if (hit !== undefined) return hit.value
  }
  const ambient = process.env.DEEPSEEK_API_KEY
  return ambient && ambient.length > 0 ? ambient : undefined
}

export function apply(ctx, config = {}) {
  if (config.enabled === false) return
  if (typeof ctx.inject !== 'function') return

  const base = publicConfig(config)

  // 余额服务：供桌宠等订阅方读取余额快照。服务始终提供，是否拉取由
  // balanceEnabled 设置决定；关闭时订阅方收到 { status: 'disabled' }。
  let balanceService
  if (typeof ctx.provide === 'function') {
    balanceService = createBalanceService({
      getApiKey: () => resolveDeepseekApiKey(ctx),
      baseUrl: base.balanceBaseUrl ?? process.env.DEEPSEEK_BASE_URL ?? DEFAULT_BALANCE_BASE_URL,
      refreshMinutes: base.balanceRefreshMinutes ?? DEFAULT_BALANCE_REFRESH_MINUTES,
      logger: ctx.logger ?? console,
    })
    ctx.provide(BALANCE_SERVICE, balanceService)
    if (typeof ctx.effect === 'function') {
      ctx.effect(() => () => balanceService.dispose())
    }
  }

  // tokenCost 投影：纯 token 折叠，无配置。
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.effect(
      () => projectionCtx.sessionProjections.register(createTokenCostProjection()),
      'dsh-deepseek-cost: tokenCost projection',
    )
  })

  // 设置命名空间 + 本地配置端点（设置页读写）。
  ctx.inject(['settings'], (settingsCtx) => {
    const settings = settingsCtx.settings?.register?.('dsh-deepseek-cost', Config, {
      base,
      applies: 'live',
    }) ?? localSettingsScope(base)

    const applyBalanceSettings = (next) => {
      if (!balanceService) return
      balanceService.setOptions({
        baseUrl: next.balanceBaseUrl ?? process.env.DEEPSEEK_BASE_URL ?? DEFAULT_BALANCE_BASE_URL,
        refreshMinutes: next.balanceRefreshMinutes ?? DEFAULT_BALANCE_REFRESH_MINUTES,
      })
      if (next.balanceEnabled === true) {
        balanceService.start()
      } else {
        balanceService.stop()
      }
    }

    applyBalanceSettings(settings.get())
    const unwatchBalance = typeof settings.watch === 'function'
      ? settings.watch((next) => applyBalanceSettings(next))
      : undefined
    if (unwatchBalance && typeof settingsCtx.effect === 'function') {
      settingsCtx.effect(() => () => unwatchBalance())
    }

    ctx.inject(['webServer'], (httpCtx) => {
      httpCtx.effect(
        () => httpCtx.webServer.register({ kind: 'exact', path: CONFIG_ENDPOINT, handler: createConfigHandler(settings) }),
        'dsh-deepseek-cost: local config endpoint',
      )
    })
  })
}
