/** DSH Desktop Host plugin: owns the selected native shell generation. */

export const name = 'desktop-shell'

/** Services required before the shell can register its native window. */
export const inject = ['webServer', 'webRuntime', 'appExit', 'settings']

export function apply(ctx, config) {
  const runtime = ctx.get('desktopRuntime')
  if (runtime === undefined) {
    process.stderr.write(
      '[dsh-desktop] this profile is composed with the desktop shell, which requires the desktop launcher (desktopRuntime).\n'
      + '[dsh-desktop] start it with `dsh-desktop`; an ordinary dsh boot keeps this row inactive.\n',
    )
    return
  }
  const appExit = ctx.get('appExit')
  if (appExit === undefined) {
    throw new Error('[dsh-desktop] the launcher did not provide ctx.appExit')
  }
  if (ctx.webServer.host !== '127.0.0.1') {
    throw new Error('[dsh-desktop] desktop shell requires a loopback web server')
  }

  const { mode = 'compatibility', width = 1280, height = 840, minWidth = 900, minHeight = 640 } = config ?? {}
  const url = `http://127.0.0.1:${ctx.webServer.port}/?dsh-desktop-mode=${encodeURIComponent(mode)}`
  const profiles = ctx.get('desktopProfiles')

  ctx.effect(() => runtime.schedule({
    url,
    mode,
    width,
    height,
    minWidth,
    minHeight,
    windowTitle: 'DeepSeek Harness',
    productName: 'DSH Desktop',
    requestQuit: appExit,
    profiles: profiles ?? undefined,
    currentProfileName: profiles?.current?.name,
  }), 'dsh-desktop: native shell generation')
}
