/** Electron implementation of the launcher-provided desktop runtime. */

const { app, BrowserWindow, Menu, nativeImage, Tray } = require('electron')

class ElectronDesktopRuntime {
  #spec
  #window
  #tray
  #quitting = false

  constructor({ productName = 'DSH Desktop' } = {}) {
    this.productName = productName
    // Headless smoke: create + load the window without showing it or a tray.
    this.headless = process.env.DSH_DESKTOP_HEADLESS === '1'
  }

  schedule(spec) {
    this.#spec = spec
    return () => {
      if (this.#spec === spec) this.#spec = undefined
    }
  }

  async mountScheduled() {
    const spec = this.#spec
    if (spec === undefined) {
      throw new Error('[dsh-desktop] desktop-shell did not schedule a native window')
    }
    const win = new BrowserWindow({
      width: spec.width,
      height: spec.height,
      minWidth: spec.minWidth,
      minHeight: spec.minHeight,
      show: false,
      title: spec.windowTitle,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    win.once('ready-to-show', () => { if (!this.headless) win.show() })
    win.on('close', (event) => {
      if (this.#quitting) return
      event.preventDefault()
      win.hide()
    })
    win.on('closed', () => {
      if (this.#window === win) this.#window = undefined
    })
    win.webContents.on('did-fail-load', (_event, code, description) => {
      process.stderr.write('[dsh-desktop] window failed to load: ' + code + ' ' + description + '\n')
    })
    this.#window = win
    await win.loadURL(spec.url)
    if (!this.headless) await this.#mountTray(spec)
  }

  async #mountTray(spec) {
    try {
      // Phase 0: empty placeholder icon; real tray icons arrive with the build.
      const tray = new Tray(nativeImage.createEmpty())
      tray.setToolTip(this.productName)
      tray.on('click', () => this.show())
      this.#tray = tray

      const template = [
        { label: 'Open', click: () => this.show() },
      ]
      if (spec.profiles !== undefined && spec.currentProfileName !== undefined) {
        const profiles = await spec.profiles.list()
        template.push({
          label: 'Profiles',
          submenu: profiles.map((profile) => ({
            label: profile.name,
            type: 'radio',
            checked: profile.name === spec.currentProfileName,
            click: () => { void spec.profiles.select(profile.name) },
          })),
        })
      }
      template.push(
        { type: 'separator' },
        { label: 'Quit', click: () => spec.requestQuit(0) },
      )
      tray.setContextMenu(Menu.buildFromTemplate(template))
    } catch (cause) {
      process.stderr.write('[dsh-desktop] tray unavailable: ' + (cause instanceof Error ? cause.message : String(cause)) + '\n')
    }
  }

  show() {
    const win = this.#window
    if (win === undefined) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }

  prepareToQuit() {
    this.#quitting = true
  }
}

module.exports = { ElectronDesktopRuntime }
