/** Headless npm launcher for the DSH Desktop Electron executable. */

import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = dirname(dirname(fileURLToPath(import.meta.url)))

let electronPath
try {
  const imported = await import('electron')
  electronPath = imported.default
} catch {
  console.error('dsh-desktop: electron is not installed; run `pnpm add -D electron` in the dsh-desktop bundle.')
  process.exit(1)
}
if (typeof electronPath !== 'string') {
  console.error('dsh-desktop: electron package did not provide its executable path.')
  process.exit(1)
}

// The DSH host may propagate ELECTRON_RUN_AS_NODE; strip it so Electron boots
// its browser (main) process instead of Node mode.
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(electronPath, [appDir, ...process.argv.slice(2)], { stdio: 'inherit', env })
child.on('error', (cause) => {
  console.error('dsh-desktop: failed to launch electron:', cause)
  process.exit(1)
})
child.on('exit', (code, signal) => {
  if (signal !== null) {
    process.exitCode = 1
    return
  }
  process.exitCode = code ?? 0
})
