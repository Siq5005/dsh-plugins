/** Headless boot smoke test: boot the desktop profile in-process (no Electron),
 * verify the web server binds and desktop-shell schedules a window with a live URL.
 * Run: DSH_HOME=/tmp/dsh-desktop-boot node --expose-internals scripts/smoke-boot.mjs
 * (--expose-internals lets the Cordis loader resolve bare entry names in plain Node.)
 */

import { bootHost } from '../src/host.js'

const scheduled = { spec: undefined }
const stubRuntime = {
  schedule(spec) {
    scheduled.spec = spec
    return () => {}
  },
}
const selected = []
const stubProfiles = {
  list: async () => [{ name: 'desktop', dir: '' }, { name: 'web', dir: '' }],
  select: async (name) => { selected.push(name) },
}

const { ctx, profile, releaseResolver } = await bootHost({
  profileName: process.env.DSH_DESKTOP_PROFILE ?? 'desktop',
  desktopRuntime: stubRuntime,
  desktopProfiles: stubProfiles,
  exit: () => {},
  onPrepare: () => {},
})

try {
  const webServer = ctx.get('webServer')
  const spec = scheduled.spec
  const profiles = ctx.get('desktopProfiles')
  if (profiles === undefined) throw new Error('desktopProfiles service missing')
  if (profiles.current.name !== profile.name) throw new Error('desktopProfiles.current mismatch')
  const listed = await profiles.list()
  if (listed.length !== 2) throw new Error('desktopProfiles.list mismatch')
  console.log('desktopProfiles.current:', profiles.current.name)
  console.log('profile:', profile.name, '->', profile.dir)
  console.log('webServer.host:', webServer.host)
  console.log('webServer.port:', webServer.port)
  console.log('scheduled.spec.url:', spec?.url)
  if (spec === undefined) throw new Error('desktop-shell did not schedule a window')
  if (!spec.url.includes('127.0.0.1')) throw new Error('scheduled url is not loopback: ' + spec.url)

  const res = await fetch(spec.url)
  const text = await res.text()
  console.log('fetch:', res.status, 'bytes:', text.length)
  console.log('html marker:', /<!doctype html|<html/i.test(text) ? 'yes' : 'no')
  if (res.status !== 200) throw new Error('web UI returned ' + res.status)
  console.log('OK: desktop-shell booted with a live loopback web UI')
} finally {
  await ctx.fiber.dispose()
  releaseResolver()
}
