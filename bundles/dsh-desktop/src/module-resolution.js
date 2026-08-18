/** Profile-relative package resolution for Electron's restricted Node runtime.
 * When the Cordis Loader cannot reach Node's internal ESM loader (Electron main
 * process), its fallback import() resolves bare names from the loader's own
 * location. This hook re-parents those requests to the selected profile so
 * in-box and profile-local plugins resolve consistently.
 */

import { registerHooks } from 'node:module'

const LOADER_ENTRY_URL = import.meta.resolve('@deepseek-ai/cordis-plugin-loader')
const DESKTOP_ENTRY_URL = new URL('../src/index.js', import.meta.url).href
const DESKTOP_PACKAGE_NAME = 'dsh-desktop'

function isBareSpecifier(specifier) {
  return !specifier.startsWith('.') && !specifier.startsWith('/') && !URL.canParse(specifier)
}

/** Install the resolver hook and return an idempotent disposer.
 * @param profileBaseUrl - file URL inside the profile that owns plugin dependencies.
 */
export function installProfilePackageResolver(profileBaseUrl) {
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      const fromLoader = context.parentURL === LOADER_ENTRY_URL
      if (fromLoader && specifier === DESKTOP_PACKAGE_NAME) {
        return { shortCircuit: true, url: DESKTOP_ENTRY_URL }
      }
      if (!fromLoader || !isBareSpecifier(specifier)) {
        return nextResolve(specifier, context)
      }
      return nextResolve(specifier, { ...context, parentURL: profileBaseUrl })
    },
  })
  let active = true
  return () => {
    if (!active) return
    active = false
    hooks.deregister()
  }
}
