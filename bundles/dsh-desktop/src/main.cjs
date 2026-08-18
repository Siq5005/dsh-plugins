/** DSH Desktop executable: Electron bootstrap around the Host Cordis root. */

const { app } = require('electron')
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { dirname, join } = require('node:path')

const BIN_NAME = 'dsh-desktop'
const PRODUCT_NAME = 'DSH Desktop'
const DEFAULT_PROFILE = 'desktop'
const SELECTION_FILENAME = 'profile-selection/state.json'

const { ElectronDesktopRuntime } = require('./runtime.cjs')

function readSelectedProfile(userData) {
  try {
    const parsed = JSON.parse(readFileSync(join(userData, SELECTION_FILENAME), 'utf8'))
    if (typeof parsed?.profileName === 'string' && parsed.profileName.length > 0) return parsed.profileName
  } catch {}
  return undefined
}

async function start() {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  const userData = app.getPath('userData')
  const selectionStatePath = join(userData, SELECTION_FILENAME)
  const PROFILE_NAME = process.env.DSH_DESKTOP_PROFILE ?? readSelectedProfile(userData) ?? DEFAULT_PROFILE

  let current
  let quitting = false
  const runtime = new ElectronDesktopRuntime({ productName: PRODUCT_NAME })

  const disposeTree = async () => {
    try {
      await current?.fiber.dispose()
    } catch (cause) {
      console.error('[dsh-desktop] dispose failed:', cause)
    }
  }
  const shutdown = async (code) => {
    if (quitting) return
    quitting = true
    runtime.prepareToQuit()
    await disposeTree()
    app.exit(code)
  }
  const requestQuit = (code) => { void shutdown(code) }

  app.on('second-instance', () => runtime.show())
  app.on('before-quit', (event) => {
    if (quitting) return
    event.preventDefault()
    void shutdown(0)
  })

  await app.whenReady()
  if (app.isPackaged && process.cwd() === '/') process.chdir(app.getPath('home'))

  const { installFailLoud } = await import('@deepseek-ai/dsh-app-boot')
  const { bootHost } = await import('./host.js')
  const { listProfiles } = await import('./profiles.js')
  installFailLoud(BIN_NAME, {
    on: (event, handler) => process.on(event, handler),
    off: (event, handler) => process.off(event, handler),
    stderr: process.stderr,
    exit: (code) => app.exit(code),
  }, disposeTree)

  const desktopProfiles = {
    list: async () => listProfiles(),
    select: async (name) => {
      const profiles = await listProfiles()
      if (!profiles.some((profile) => profile.name === name)) {
        throw new Error(BIN_NAME + ': unknown profile ' + JSON.stringify(name))
      }
      mkdirSync(dirname(selectionStatePath), { recursive: true })
      writeFileSync(selectionStatePath, JSON.stringify({ profileName: name }, null, 2) + '\n')
      app.relaunch()
      app.exit(0)
    },
  }

  try {
    const { ctx, profile } = await bootHost({
      profileName: PROFILE_NAME,
      desktopRuntime: runtime,
      desktopProfiles,
      exit: requestQuit,
      onPrepare: (hostCtx) => { current = hostCtx },
    })
    current = ctx
    await runtime.mountScheduled()
    console.error('[dsh-desktop] ready (profile: ' + profile.name + ')')
  } catch (cause) {
    console.error('[dsh-desktop] boot failed:', cause)
    await shutdown(1)
  }
}

void start()
