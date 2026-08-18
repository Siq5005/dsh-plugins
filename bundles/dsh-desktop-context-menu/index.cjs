/** dsh-desktop-context-menu host plugin (CommonJS).
 *
 * Adds a native right-click context menu to every DSH Desktop BrowserWindow.
 * Only active in the Electron main process; in plain Node / web this plugin
 * is a no-op, so it is safe to leave installed in a normal web profile.
 */

function isElectronMain() {
  return typeof process !== 'undefined'
    && process.versions !== undefined
    && typeof process.versions.electron === 'string'
}

/** Build the menu template for one context-menu event. */
function buildTemplate(win, params) {
  const template = []
  if (params.isEditable) {
    if (params.editFlags?.canCut) template.push({ role: 'cut' })
    if (params.editFlags?.canCopy) template.push({ role: 'copy' })
    if (params.editFlags?.canPaste) template.push({ role: 'paste' })
    if (params.editFlags?.canSelectAll) template.push({ role: 'selectAll' })
  } else {
    if (params.selectionText !== '') template.push({ role: 'copy' })
    template.push({ role: 'selectAll' })
  }

  const history = win.webContents?.navigationHistory
  const canGoBack = typeof history?.canGoBack === 'function' && history.canGoBack()
  const canGoForward = typeof history?.canGoForward === 'function' && history.canGoForward()
  if (canGoBack || canGoForward) {
    if (template.length > 0) template.push({ type: 'separator' })
    if (canGoBack) template.push({ label: 'Back', click: () => history.goBack() })
    if (canGoForward) template.push({ label: 'Forward', click: () => history.goForward() })
  }

  return template
}

function apply(ctx) {
  if (!isElectronMain()) return

  // In the Electron main process require('electron') returns the built-in
  // API object (same behavior D-008 relies on for src/runtime.cjs).
  const electron = require('electron')
  const { app, BrowserWindow, Menu } = electron ?? {}
  if (typeof app?.on !== 'function' || typeof Menu?.buildFromTemplate !== 'function') return

  const attached = new WeakSet()

  const attach = (win) => {
    if (win === null || typeof win !== 'object') return
    if (typeof win.isDestroyed === 'function' && win.isDestroyed()) return
    const webContents = win.webContents
    if (webContents === undefined || attached.has(webContents)) return
    attached.add(webContents)
    webContents.on('context-menu', (event, params) => {
      event.preventDefault()
      const template = buildTemplate(win, params)
      if (template.length === 0) return
      Menu.buildFromTemplate(template).popup({ window: win })
    })
  }

  const onWindowCreated = (_event, win) => attach(win)
  app.on('browser-window-created', onWindowCreated)
  for (const win of (BrowserWindow?.getAllWindows?.() ?? [])) attach(win)

  if (ctx !== undefined && typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      if (typeof app.off === 'function') app.off('browser-window-created', onWindowCreated)
    })
  }
}

module.exports = { name: 'desktop-context-menu', apply }
