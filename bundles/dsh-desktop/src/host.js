/** Electron-independent Host Cordis boot for DSH Desktop.
 * Shared by the Electron bootstrap (main.js) and the headless smoke test.
 */

import { existsSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  boot,
  composeEntries,
  healProfilesModuleFallback,
  initProfile,
  loadLayeredEnv,
  loadOptionalPatches,
  loadOverlayPatches,
  loadProfile,
  resolveProfileDir,
} from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { installProfilePackageResolver } from './module-resolution.js'

const BIN_NAME = 'dsh-desktop'
const PROFILE_ROOT_FILENAME = 'cordis.yml'
const PROFILE_ROOT_CONFIG = '# dsh profile root — an empty entry list composed as patch layers.\n[]\n'
const DESKTOP_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']

const INSTALL_ANCHOR = fileURLToPath(new URL('../package.json', import.meta.url))
const DESKTOP_PATCH_PATH = fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))
const require = createRequire(import.meta.url)
// Shipped agent presets live beside the @deepseek-ai/dsh package (code/cordis/
// minimal/standard). The upstream dsh CLI injects this root; we must do the same.
const SHIPPED_PRESET_ROOT = join(dirname(require.resolve('@deepseek-ai/dsh/package.json')), 'config', 'agent-presets')

function homePatchPath() {
  return join(resolveDshHome(), 'cordis.patch.yml')
}

function prepareProfile(name) {
  const home = resolveDshHome()
  const dir = resolveProfileDir(name, home)
  if (!existsSync(join(dir, 'package.json'))) {
    initProfile(dir, DESKTOP_BUNDLES)
  }
  healProfilesModuleFallback(INSTALL_ANCHOR, home)
  const profile = loadProfile(BIN_NAME, name, INSTALL_ANCHOR, home)
  writeFileSync(join(profile.dir, PROFILE_ROOT_FILENAME), PROFILE_ROOT_CONFIG)
  return profile
}

/** Compose the desktop profile's patch stack with the desktop layer spliced
 * after @deepseek-ai/dsh-web-app. Never persisted into dsh.profile.bundles.
 */
export function composeProfile(name) {
  const profile = prepareProfile(name)
  const desktopPatches = loadOverlayPatches(BIN_NAME, DESKTOP_PATCH_PATH) ?? []
  const bundlePatches = []
  let desktopLayerInserted = false
  for (const layer of profile.layers) {
    bundlePatches.push(...layer.patches)
    if (layer.packageName === '@deepseek-ai/dsh-web-app') {
      bundlePatches.push(...desktopPatches)
      desktopLayerInserted = true
    }
  }
  if (!desktopLayerInserted) {
    throw new Error(BIN_NAME + ': desktop profile ' + name + ' is missing @deepseek-ai/dsh-web-app')
  }
  const homePatches = loadOptionalPatches(BIN_NAME, homePatchPath()) ?? []
  const base = [
    ...bundlePatches,
    ...profile.patches,
    ...homePatches,
  ]
  // Mirror the upstream dsh CLI: inject the shipped agent-presets root into the
  // agent-presets row, otherwise only plugin-registered presets appear.
  const rows = new Map()
  for (const row of composeEntries([base])) {
    if (typeof row.id === 'string') rows.set(row.id, row)
  }
  const overlays = []
  if (rows.has('agent-presets')) {
    overlays.push({
      id: 'agent-presets',
      config: {
        ...rows.get('agent-presets')?.config ?? {},
        roots: [{ path: SHIPPED_PRESET_ROOT, trust: 'system' }],
      },
    })
  }
  return {
    profile,
    patches: [...base, ...overlays],
  }
}

/** Boot the Host Cordis root in-process and return the settled context.
 * @param desktopRuntime - launcher-provided runtime injected as ctx.desktopRuntime.
 * @param exit - exit request passed to provideCmdline (ctx.appExit).
 * @param onPrepare - callback receiving the partial host context before mount.
 * @param desktopProfiles - optional { list, select } injected as ctx.desktopProfiles.
 */
export async function bootHost({ profileName = 'desktop', desktopRuntime, exit = () => {}, onPrepare, desktopProfiles } = {}) {
  const environment = loadLayeredEnv(BIN_NAME, process.cwd())
  const composed = composeProfile(profileName)
  const patches = structuredClone(composed.patches)
  const rootConfig = join(composed.profile.dir, PROFILE_ROOT_FILENAME)
  // Bare entry names (including this desktop package) resolve beside the profile
  // manifest; healProfilesModuleFallback symlinks the dependency closure there.
  const bareModuleBaseUrl = pathToFileURL(join(composed.profile.dir, 'package.json')).href
  // Electron's main process cannot reach Node's internal ESM loader, so the
  // Cordis Loader falls back to import() from its own location. Re-parent those
  // bare requests to the profile manifest. Plain Node can still use the internal
  // loader path; the hook only changes requests the loader itself issues.
  const releaseResolver = installProfilePackageResolver(bareModuleBaseUrl)

  let ctx
  try {
    ctx = await boot(
      BIN_NAME,
      rootConfig,
      patches,
      async (hostCtx) => {
        onPrepare?.(hostCtx)
        hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, environment)
        if (desktopRuntime !== undefined) hostCtx.provide('desktopRuntime', desktopRuntime)
        if (desktopProfiles !== undefined) {
          hostCtx.provide('desktopProfiles', {
            current: Object.freeze({ name: composed.profile.name, dir: composed.profile.dir }),
            list: desktopProfiles.list,
            select: desktopProfiles.select,
          })
        }
        provideCmdline(hostCtx, {
          args: ['--host', '127.0.0.1', '--port', '0'],
          exit,
        })
      },
      bareModuleBaseUrl,
    )
  } catch (cause) {
    releaseResolver()
    throw cause
  }
  return { ctx, profile: composed.profile, releaseResolver }
}
