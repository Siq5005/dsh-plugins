/** Headless smoke test: compose the desktop profile and print the entry order.
 * Run: DSH_HOME=/tmp/dsh-desktop-smoke node scripts/smoke-profile.mjs
 */

import { composeEntries } from '@deepseek-ai/dsh-app-boot'
import { composeProfile } from '../src/host.js'

const PROFILE_NAME = process.env.DSH_DESKTOP_PROFILE ?? 'desktop'
const { profile, patches } = composeProfile(PROFILE_NAME)
const rows = composeEntries([patches])

console.log('profile:', profile.name, '->', profile.dir)
console.log('layers:', profile.layers.map(function (l) { return l.packageName }).join(', '))
console.log('--- composed rows ---')
for (const row of rows) {
  if (row && typeof row === 'object') {
    console.log('  ' + (row.id ?? '(no id)') + '  name=' + (row.name ?? '-'))
  } else {
    console.log('  ' + String(row))
  }
}
const ids = rows.filter(function (r) { return r && typeof r === 'object' && r.id }).map(function (r) { return r.id })
if (!ids.includes('desktop-shell')) throw new Error('desktop-shell row missing from composed tree')
console.log('OK: desktop-shell row present at index ' + ids.indexOf('desktop-shell'))

const presetOverlay = patches.find(function (p) { return p && p.id === 'agent-presets' && p.config && Array.isArray(p.config.roots) })
if (presetOverlay === undefined) throw new Error('agent-presets shipped root overlay missing')
console.log('OK: agent-presets shipped root injected:', JSON.stringify(presetOverlay.config.roots))
