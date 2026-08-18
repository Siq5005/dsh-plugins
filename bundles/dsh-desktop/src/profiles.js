/** Read-only desktop profile discovery. Electron-independent. */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** Enumerate initialized DSH profiles under $DSH_HOME/profiles.
 * Never mutates profiles; a profile counts as initialized when its manifest
 * declares dsh.profile.bundles.
 */
export function listProfiles(home = resolveDshHome()) {
  const root = join(home, 'profiles')
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  const result = []
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    const dir = join(root, entry.name)
    let manifest
    try {
      manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    } catch {
      continue
    }
    const bundles = manifest?.dsh?.profile?.bundles
    if (!Array.isArray(bundles) || bundles.length === 0) continue
    result.push({ name: entry.name, dir })
  }
  result.sort((a, b) => a.name.localeCompare(b.name))
  return result
}
