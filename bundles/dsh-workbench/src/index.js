/**
 * dsh-workbench 插件入口（Host 侧）。
 *
 * 职责：为右侧工作台提供真实的文件系统与 git 数据服务，经
 * `/dsh-workbench/*` HTTP 路由暴露给浏览器端（JSON 请求/响应）。
 * 借鉴 dsh-better-sidebar (MIT) 与 dsh-web-ui/dsh-aionui-panel
 * (BSD-3-Clause) 的设计：会话 cwd 作根、真实 fs/git、loopback 围栏。
 *
 * 路由（POST JSON）：
 *   /dsh-workbench/workspaces          列出工作区
 *   /dsh-workbench/list                { root, path } -> 目录项
 *   /dsh-workbench/readText            { root, path } -> 文本
 *   /dsh-workbench/writeText           { root, path, content }
 *   /dsh-workbench/readImage           { root, path } -> dataURL
 *   /dsh-workbench/git.status          { cwd } -> 分支 + 变更列表
 *   /dsh-workbench/git.diff            { cwd, path?, staged? }
 *   /dsh-workbench/git.log             { cwd }
 *   /dsh-workbench/git.stage|unstage|restore|commit
 */
export const name = 'dsh-workbench'
export const inject = ['webServer', 'subprocess', 'workspaceRegistry']

const ROUTE_PREFIX = '/dsh-workbench'

/** 读取 JSON 请求体；空/非法返回 {}。 */
async function readJsonBody(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    chunks.push(buf)
    total += buf.length
    if (total > (1 << 20)) return {}
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

/** 简化版 loopback 围栏：socket 地址或 Host 头指向本机才放行。 */
function isLoopback(req) {
  const addr = req.socket && req.socket.remoteAddress
  if (addr) {
    const a = addr.toLowerCase()
    if (a === '::1') return true
    if (a.startsWith('::ffff:')) return a.startsWith('::ffff:127.')
    if (a.startsWith('127.')) return true
  }
  const host = (req.headers && req.headers.host) || ''
  return host.startsWith('localhost') || host.startsWith('127.') || host.startsWith('[::1]')
}

export function apply(ctx) {
  const webServer = ctx.webServer
  const subprocess = ctx.subprocess
  const workspaceRegistry = ctx.workspaceRegistry
  const fs = ctx.get('fs')
  if (!fs || !webServer) {
    console.log('dsh-workbench: fs/webServer missing, disabled')
    return
  }

  function req(args, key) {
    const v = args && args[key]
    if (v === undefined || v === null || v === '') throw new Error('missing ' + key)
    return v
  }
  function opt(args, key, dflt) {
    const v = args && args[key]
    return v === undefined || v === null ? dflt : v
  }

  let gitPath = null
  async function gitExe() {
    if (gitPath === null) gitPath = await subprocess.resolveExecutable('git').catch(() => null)
    return gitPath
  }

  async function runGit(cwd, args, maxOut) {
    const exe = await gitExe()
    if (!exe) return { code: -1, out: '', err: 'git 不可用' }
    const handle = subprocess.spawn({
      argv: [exe].concat(args),
      cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: maxOut || 2 * 1024 * 1024 },
        stderr: { maxBytes: 512 * 1024 },
      },
      graceMs: 8000,
    })
    const outcome = await handle.done
    const out = handle.collected && handle.collected.stdout ? handle.collected.stdout.readFrom(0).text : ''
    const err = handle.collected && handle.collected.stderr ? handle.collected.stderr.readFrom(0).text : ''
    return { code: outcome.exitCode, out, err }
  }

  async function resolveChild(root, rel) {
    const rootTarget = await fs.resolve(root)
    if (!rel || rel === '.') return { child: rootTarget, path: fs.processPath(rootTarget) }
    const child = await fs.resolve(rel, { cwd: root })
    if (!fs.contains(rootTarget, child)) throw new Error('路径越界: ' + rel)
    return { child, path: fs.processPath(child) }
  }

  const methods = {
    async workspaces() {
      const items = []
      if (workspaceRegistry) {
        for (const w of workspaceRegistry.list()) {
          const path = w.path || w.cwd || ''
          if (!path) continue
          items.push({ path, title: w.title || String(path).split('/').filter(Boolean).pop() || path })
        }
      }
      return { ok: true, items }
    },

    async list(args) {
      const root = req(args, 'root')
      const rel = opt(args, 'path', '.')
      const { child, path } = await resolveChild(root, rel)
      const st = await fs.stat(child)
      if (!st) return { ok: false, error: '不存在: ' + rel }
      if (st.type !== 'directory') return { ok: false, error: '不是目录: ' + rel }
      const raw = await fs.listDir(child)
      const entries = raw.map((e) => ({
        name: e.name,
        type: e.type === 'directory' ? 'dir' : e.type === 'file' ? 'file' : 'other',
        size: e.size === undefined ? null : e.size,
      }))
      entries.sort((a, b) => (a.type === 'dir' && b.type !== 'dir' ? -1 : b.type === 'dir' && a.type !== 'dir' ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      return { ok: true, path, entries }
    },

    async readText(args) {
      const root = req(args, 'root')
      const rel = req(args, 'path')
      const { child } = await resolveChild(root, rel)
      const st = await fs.stat(child)
      if (!st) return { ok: false, error: '不存在' }
      if (st.type !== 'file') return { ok: false, error: '不是文件' }
      if (st.size !== undefined && st.size > 2 * 1024 * 1024) return { ok: false, tooLarge: true, size: st.size }
      const content = await fs.readText(child)
      return { ok: true, content }
    },

    async writeText(args) {
      const root = req(args, 'root')
      const rel = req(args, 'path')
      const content = req(args, 'content')
      const { child } = await resolveChild(root, rel)
      await fs.writeText(child, content)
      return { ok: true }
    },

    async readImage(args) {
      const root = req(args, 'root')
      const rel = req(args, 'path')
      const { child } = await resolveChild(root, rel)
      const st = await fs.stat(child)
      if (!st) return { ok: false, error: '不存在' }
      if (st.type !== 'file') return { ok: false, error: '不是文件' }
      if (st.size !== undefined && st.size > 8 * 1024 * 1024) return { ok: false, error: '图片过大 (>8MB)' }
      const bytes = await fs.readBytes(child, undefined, 8 * 1024 * 1024)
      let bin = ''
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
      const b64 = btoa(bin)
      const ext = String(rel).split('.').pop().toLowerCase()
      const img = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif']
      const mime = img.indexOf(ext) >= 0 ? (ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : 'image/' + ext) : 'application/octet-stream'
      return { ok: true, dataUrl: 'data:' + mime + ';base64,' + b64, size: bytes.length }
    },

    async 'git.status'(args) {
      const cwd = req(args, 'cwd')
      const r = await runGit(cwd, ['-c', 'core.quotepath=false', 'status', '--porcelain=v1', '--branch'])
      if (r.code !== 0) return { ok: false, error: r.err || 'git status 失败' }
      const entries = []
      let branch = null
      for (const line of r.out.split('\n')) {
        if (!line) continue
        if (line.charAt(0) === '#') {
          const m = line.match(/^##\s+([^\s.]+)/)
          if (m) branch = m[1]
          continue
        }
        const code = line.slice(0, 2)
        let path = line.slice(3)
        const rm = path.match(/^(.*) -> (.*)$/)
        entries.push({ code, staged: code[0] !== ' ' && code[0] !== '?', worktree: code[1] !== ' ', path: rm ? rm[2] : path, from: rm ? rm[1] : null })
      }
      const head = await runGit(cwd, ['rev-parse', '--short', 'HEAD'])
      return { ok: true, branch, head: head.code === 0 ? head.out.trim() : null, entries }
    },

    async 'git.diff'(args) {
      const cwd = req(args, 'cwd')
      const path = opt(args, 'path')
      const staged = args.staged === true
      const argv = ['-c', 'core.quotepath=false', 'diff', '--no-color']
      if (staged) argv.push('--cached')
      if (path) argv.push('--', path)
      const r = await runGit(cwd, argv, 4 * 1024 * 1024)
      if (r.code !== 0) return { ok: false, error: r.err || 'diff 失败' }
      return { ok: true, diff: r.out || '(无差异)' }
    },

    async 'git.log'(args) {
      const cwd = req(args, 'cwd')
      const r = await runGit(cwd, ['log', '--pretty=format:%h%x1f%an%x1f%ad%x1f%s', '--date=short', '-30'])
      if (r.code !== 0) return { ok: false, error: r.err || 'git log 失败' }
      const commits = r.out.split('\n').filter(Boolean).map((line) => {
        const i = line.indexOf('\x1f')
        const hash = i < 0 ? line : line.slice(0, i)
        const rest = i < 0 ? '' : line.slice(i + 1)
        const j = rest.indexOf('\x1f')
        const author = j < 0 ? '' : rest.slice(0, j)
        const k = j < 0 ? -1 : rest.indexOf('\x1f', j + 1)
        const date = k < 0 ? '' : rest.slice(j + 1, k)
        const subject = k < 0 ? rest : rest.slice(k + 1)
        return { hash, author, date, subject }
      })
      return { ok: true, commits }
    },

    async 'git.stage'(args) {
      const cwd = req(args, 'cwd')
      const path = req(args, 'path')
      const r = await runGit(cwd, ['add', '--', path])
      return r.code === 0 ? { ok: true } : { ok: false, error: r.err || 'stage 失败' }
    },

    async 'git.unstage'(args) {
      const cwd = req(args, 'cwd')
      const path = req(args, 'path')
      const r = await runGit(cwd, ['restore', '--staged', '--', path])
      return r.code === 0 ? { ok: true } : { ok: false, error: r.err || 'unstage 失败' }
    },

    async 'git.restore'(args) {
      const cwd = req(args, 'cwd')
      const path = req(args, 'path')
      const r = await runGit(cwd, ['restore', '--', path])
      return r.code === 0 ? { ok: true } : { ok: false, error: r.err || 'restore 失败' }
    },

    async 'git.commit'(args) {
      const cwd = req(args, 'cwd')
      const msg = req(args, 'message')
      if (!String(msg).trim()) return { ok: false, error: '提交信息为空' }
      const r = await runGit(cwd, ['commit', '-m', String(msg)])
      return r.code === 0 ? { ok: true, out: r.out } : { ok: false, error: r.err || r.out || 'commit 失败' }
    },
  }

  async function handler(req, res) {
    if (!isLoopback(req)) {
      res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: 'forbidden: loopback-only' }))
      return
    }
    const pathname = (req.url || '').split('?')[0]
    const method = pathname.startsWith(ROUTE_PREFIX + '/') ? pathname.slice(ROUTE_PREFIX.length + 1) : ''
    const fn = methods[method]
    if (!fn) {
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: 'unknown method: ' + method }))
      return
    }
    const args = await readJsonBody(req)
    let result
    try {
      result = await fn(args)
    } catch (e) {
      result = { ok: false, error: String((e && e.message) || e) }
    }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(result))
  }

  ctx.effect(() => webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler }))
}
