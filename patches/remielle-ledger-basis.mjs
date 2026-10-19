#!/usr/bin/env node
/**
 * 统一「今日花费」口径：把 dsh-pet-remielle 的今日已用改为读 dsh-cost-meter 账本。
 * remielle 默认「余额差值累计」（自述有误差），cost-meter 是逐次 token×价目表，两者必然打架。
 *
 * 用法：node patches/remielle-ledger-basis.mjs          应用（幂等）
 *       node patches/remielle-ledger-basis.mjs --check  只检查
 * 插件升级后重跑一次即可。回滚：cp src/balance.js.bak-prebasis src/balance.js
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const TARGET = path.join(os.homedir(), '.dsh/profiles/desktop/node_modules/dsh-pet-remielle/src/balance.js')
const MARK = 'unified-basis'
const checkOnly = process.argv.includes('--check')

if (!fs.existsSync(TARGET)) { console.error('target not found:', TARGET); process.exit(2) }
const src = fs.readFileSync(TARGET, 'utf8')

const HELPER = [
  '  // [unified-basis] 今日花费唯一口径：读 dsh-cost-meter 账本（与费用面板同源）',
  "  const COST_METER_LEDGER = path.join(DSH_HOME, 'storages', 'cost-meter', 'ledger.json')",
  '  function readCostMeterToday() {',
  '    try {',
  "      const raw = JSON.parse(fs.readFileSync(COST_METER_LEDGER, 'utf8'))",
  '      const day = raw && raw.days && raw.days[todayKey()]',
  '      if (!day) return null',
  '      const cny = Number(day.costCny)',
  '      if (isFinite(cny)) return cny',
  '      const api = Number(day.apiCostCny)',
  '      return isFinite(api) ? api : null',
  '    } catch (err) { return null }',
  '  }',
].join('\n')

const OVERRIDE = [
  '    // [unified-basis] 优先用 cost-meter 账本的今日花费，读不到才回落原逻辑',
  '    {',
  '      const meterToday = readCostMeterToday()',
  '      if (meterToday !== null) {',
  '        full.todayUsage = meterToday',
  "        full.usageMode = 'ledger'",
  "        full.usageBasis = 'cost-meter'",
  '        return full',
  '      }',
  '    }',
].join('\n')

if (src.includes(MARK)) {
  console.log(checkOnly ? 'PATCHED' : 'already patched, nothing to do')
  process.exit(0)
}
if (checkOnly) { console.log('NOT PATCHED'); process.exit(1) }

const ANCHOR_CACHE = '  let balanceCache = null'
const ANCHOR_BRANCH = "    if (mode === 'ledger') {"
if (!src.includes(ANCHOR_CACHE)) { console.error('anchor(balanceCache) missing'); process.exit(3) }
if (!src.includes(ANCHOR_BRANCH)) { console.error('anchor(ledger branch) missing'); process.exit(4) }

let out = src.replace(ANCHOR_CACHE, HELPER + '\n' + ANCHOR_CACHE)
out = out.replace(ANCHOR_BRANCH, OVERRIDE + '\n' + ANCHOR_BRANCH)
fs.copyFileSync(TARGET, TARGET + '.bak-prebasis')
fs.writeFileSync(TARGET, out)
console.log('patched:', TARGET)