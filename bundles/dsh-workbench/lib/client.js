// dsh-workbench WebUI client 半区：右侧 details 列工作台。
// 手写 module-loader 包（参照仓库内 dsh-dafeiyu-mac / dsh-deepseek-cost 的
// lib/client.js 写法）：React 来自 require('react')，数据经 /dsh-workbench/*
// HTTP 路由 fetch（host 侧 src/index.js），CSS 注入 <style>。
// 布局：右侧 shell details 列（layout.openDetails/closeDetails 控制），
// 顶部 tab 栏（文件/浏览器/Git）+ 底部面板；入口为会话头部「工作台」按钮。
window.__ModuleLoader__.load({ id: 'dsh-workbench', factory: (require) => {
  const module = { exports: {} }
  const exports = module.exports
  const React = require('react')
  const { useState, useEffect } = React

  const el = React.createElement
  const cx = (...xs) => xs.filter(Boolean).join(' ')
  const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif'])
  const VIEWS = [
    { id: 'files', label: '文件', icon: '📁' },
    { id: 'browser', label: '浏览器', icon: '🌐' },
    { id: 'git', label: 'Git', icon: '🌿' },
  ]
  const API = '/dsh-workbench'

  let layoutSvc
  let timerSvc

  async function call(method, args) {
    let res
    try {
      res = await fetch(`${API}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args || {}),
      })
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) }
    }
    try {
      return await res.json()
    } catch {
      return { ok: false, error: 'HTTP ' + res.status }
    }
  }

  const tabStore = {
    tab: 'files',
    subs: new Set(),
    get() { return this.tab },
    set(t) { this.tab = t; this.subs.forEach((fn) => fn()) },
    subscribe(fn) { this.subs.add(fn); return () => this.subs.delete(fn) },
  }

  function useTab() {
    const [t, setT] = useState(tabStore.get())
    useEffect(() => tabStore.subscribe(setT), [])
    return t
  }

  function injectCss(css) {
    const style = document.createElement('style')
    style.textContent = css
    document.head.appendChild(style)
  }

  injectCss(`
.wb2-root{display:flex;flex-direction:column;height:100%;min-width:0;background:var(--dsw-alias-bg-layer-1,#202127);color:var(--dsw-alias-label-primary,#e6e6e6);font-size:13px;font-family:system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif}
.wb2-root *{box-sizing:border-box}
.wb2-head{display:flex;align-items:center;gap:6px;padding:4px 6px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));flex:0 0 auto;background:var(--dsw-alias-bg-layer-2,#26272c)}
.wb2-sub{font-size:11px;color:var(--dsw-alias-label-secondary,#9a9aa0);flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.wb2-body{display:flex;flex:1 1 auto;min-height:0}
.wb2-main{display:flex;flex-direction:column;flex:1 1 auto;min-width:0}
.wb2-pane-top{flex:1 1 auto;min-height:0;overflow:hidden;display:flex}
.wb2-pane-top > div{flex:1 1 auto;min-width:0}
.wb2-pane-bottom{flex:0 0 auto;display:flex;flex-direction:column;min-height:0}
.wb-btn{background:transparent;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.12));color:var(--dsw-alias-label-primary,#e6e6e6);border-radius:4px;padding:2px 8px;font-size:12px;cursor:pointer;white-space:nowrap}
.wb-btn:hover{background:rgba(127,127,127,.14)}
.wb-btn:disabled{opacity:.4;cursor:default}
.wb-primary{background:var(--dsw-alias-brand-primary,#4d6bfe);border-color:transparent;color:#fff}
.wb-tabbar{display:flex;align-items:center;gap:2px;padding:2px 4px;flex:0 0 auto}
.wb-tab{background:transparent;border:none;color:var(--dsw-alias-label-secondary,#9a9aa0);border-radius:4px;padding:3px 10px;font-size:12px;cursor:pointer}
.wb-tab:hover{background:rgba(127,127,127,.14)}
.wb-tab.is-active{background:var(--dsw-alias-brand-primary,#4d6bfe);color:#fff}
.wb-slider{display:flex;align-items:center;gap:4px;color:var(--dsw-alias-label-secondary,#9a9aa0);font-size:11px}
.wb-slider input{width:64px;accent-color:var(--dsw-alias-brand-primary,#4d6bfe)}
.wb-files{display:flex;flex-direction:column;width:100%;min-width:0;min-height:0}
.wb-rootbar{display:flex;gap:4px;padding:6px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));flex:0 0 auto}
.wb-input{flex:1;min-width:0;background:var(--dsw-alias-bg-base,#17181c);color:inherit;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.12));border-radius:4px;padding:3px 6px;font-size:12px;outline:none}
.wb-wsrow{display:flex;flex-wrap:wrap;gap:4px;padding:4px 6px;flex:0 0 auto;color:var(--dsw-alias-label-secondary,#9a9aa0);font-size:11px;align-items:center}
.wb-chip{background:rgba(127,127,127,.16);border:none;color:var(--dsw-alias-label-primary,#e6e6e6);border-radius:10px;padding:1px 8px;font-size:11px;cursor:pointer}
.wb-chip:hover{background:rgba(127,127,127,.28)}
.wb-split{display:flex;flex:1 1 auto;min-height:0}
.wb-tree{width:46%;overflow:auto;border-right:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));flex:0 0 auto}
.wb-edit{flex:1 1 auto;overflow:hidden;display:flex;flex-direction:column;min-width:0}
.wb-node{display:flex;align-items:center;gap:4px;padding:2px 6px;cursor:pointer;white-space:nowrap;user-select:none;font-size:12px}
.wb-node:hover{background:rgba(127,127,127,.12)}
.wb-node.is-selected{background:rgba(77,107,254,.24)}
.wb-caret{width:12px;flex:0 0 auto;color:var(--dsw-alias-label-secondary,#9a9aa0);font-size:10px}
.wb-nm.is-dir{font-weight:600}
.wb-hint{color:var(--dsw-alias-label-secondary,#9a9aa0);padding:16px;text-align:center;font-size:12px;width:100%}
.wb-err{color:var(--dsw-alias-state-error-primary,#f56c6c);padding:4px 8px;font-size:12px;flex:0 0 auto}
.wb-ok{color:var(--dsw-alias-state-success-primary,#67c23a);padding:4px 8px;font-size:12px;flex:0 0 auto}
.wb-editor{display:flex;flex-direction:column;flex:1 1 auto;min-height:0}
.wb-edithead{display:flex;align-items:center;gap:6px;padding:4px 6px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));flex:0 0 auto}
.wb-filepath{font-size:11px;color:var(--dsw-alias-label-secondary,#9a9aa0);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 auto}
.wb-dirty{font-size:11px;color:var(--dsw-alias-state-warn-primary,#e6a23c);flex:0 0 auto}
.wb-textarea{flex:1 1 auto;background:var(--dsw-alias-bg-base,#17181c);color:inherit;border:none;outline:none;resize:none;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;padding:8px;tab-size:2;line-height:1.5}
.wb-md{flex:1 1 auto;overflow:auto;padding:12px;font-size:13px;line-height:1.6}
.wb-md pre{background:var(--dsw-alias-bg-base,#17181c);padding:8px;border-radius:4px;overflow:auto}
.wb-md code{background:rgba(127,127,127,.2);padding:0 3px;border-radius:3px;font-family:ui-monospace,Menlo,monospace}
.wb-md h1,.wb-md h2,.wb-md h3{margin:.5em 0 .3em}
.wb-preview{flex:1 1 auto;overflow:auto;display:flex;align-items:flex-start;justify-content:center;padding:8px}
.wb-preview img{max-width:100%;height:auto}
.wb-browser{display:flex;flex-direction:column;width:100%;min-width:0;min-height:0}
.wb-navbar{display:flex;gap:4px;padding:6px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));flex:0 0 auto}
.wb-ext{color:var(--dsw-alias-brand-primary,#4d6bfe);text-decoration:none}
.wb-iframe{flex:1 1 auto;width:100%;border:none;background:#fff;min-height:0}
.wb-git{display:flex;flex-direction:column;width:100%;min-width:0;min-height:0}
.wb-gitbar{display:flex;align-items:center;gap:6px;padding:4px 6px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));flex:0 0 auto;font-size:12px}
.wb-git-meta{color:var(--dsw-alias-label-secondary,#9a9aa0);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wb-git-sub{display:flex;gap:2px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));flex:0 0 auto;padding:2px 4px}
.wb-git-row{display:flex;align-items:center;gap:6px;padding:2px 8px;cursor:pointer;font-size:12px;white-space:nowrap}
.wb-git-row:hover{background:rgba(127,127,127,.12)}
.wb-git-row.is-sel{background:rgba(77,107,254,.22)}
.wb-badge{font-family:ui-monospace,Menlo,monospace;font-size:10px;padding:0 3px;border-radius:3px;background:rgba(127,127,127,.2);flex:0 0 auto}
.wb-badge.s{color:var(--dsw-alias-state-success-primary,#67c23a)}
.wb-badge.w{color:var(--dsw-alias-state-warn-primary,#e6a23c)}
.wb-git-path{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis}
.wb-git-act{background:transparent;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.12));border-radius:3px;color:var(--dsw-alias-label-secondary,#9a9aa0);font-size:11px;padding:0 6px;cursor:pointer;flex:0 0 auto}
.wb-git-act:hover{background:rgba(127,127,127,.14)}
.wb-diff{flex:1 1 auto;overflow:auto;margin:0;padding:6px;font-family:ui-monospace,Menlo,monospace;font-size:11px;line-height:1.5;background:var(--dsw-alias-bg-base,#17181c)}
.wb-dline{white-space:pre;min-height:1.2em}
.wb-dline.add{color:var(--dsw-alias-state-success-primary,#67c23a)}
.wb-dline.del{color:var(--dsw-alias-state-error-primary,#f56c6c)}
.wb-dline.meta{color:var(--dsw-alias-label-secondary,#9a9aa0)}
.wb-commitbar{display:flex;gap:4px;padding:4px 6px;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));flex:0 0 auto}
.wb-log{flex:0 1 30%;overflow:auto;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));font-size:11px}
.wb-log-row{display:flex;gap:6px;padding:2px 8px;white-space:nowrap}
.wb-log-hash{color:var(--dsw-alias-brand-primary,#4d6bfe);font-family:ui-monospace,Menlo,monospace}
.wb-log-sub{overflow:hidden;text-overflow:ellipsis;flex:1 1 auto}
.wb-log-date{color:var(--dsw-alias-label-secondary,#9a9aa0);flex:0 0 auto}
.wb-ficon{background:transparent;border:none;color:var(--dsw-alias-label-secondary,#9a9aa0);font-size:12px;cursor:pointer;padding:4px 6px;border-radius:4px;white-space:nowrap}
.wb-ficon:hover{background:rgba(127,127,127,.14);color:var(--dsw-alias-label-primary,#e6e6e6)}
`)

  function HeaderButton() {
    return el('button', { className: 'wb-ficon', title: '打开工作台', onClick: () => { const l = layoutSvc; if (l) l.openDetails() } }, '工作台')
  }

  function WorkbenchPanel(props) {
    const useSessions = props.useSessions
    const cwd = useSessions
      ? useSessions((s) => (s && s.current && s.byId && s.byId[s.current] ? s.byId[s.current].cwd : undefined))
      : undefined
    const rightTab = useTab()
    const [bottomTab, setBottomTab] = useState('git')
    const [bottomH, setBottomH] = useState(220)
    const [showBottom, setShowBottom] = useState(true)
    return el('div', { className: 'wb2-root' },
      el('div', { className: 'wb2-head' },
        el('div', { className: 'wb-tabbar' },
          VIEWS.map((v) => el('button', {
            key: v.id,
            className: cx('wb-tab', rightTab === v.id && 'is-active'),
            onClick: () => tabStore.set(v.id),
          }, v.label)),
        ),
        el('span', { className: 'wb2-sub', title: cwd || '' }, cwd || '无工作目录'),
        el('button', { className: 'wb-btn', onClick: () => { const l = layoutSvc; if (l) l.closeDetails() } }, '关闭'),
      ),
      el('div', { className: 'wb2-body' },
        el('div', { className: 'wb2-main' },
          el('div', { className: 'wb2-pane-top' },
            rightTab === 'files' ? el(FilesPane, { root: cwd }) :
            rightTab === 'browser' ? el(BrowserPane, {}) :
            el(GitPane, { cwd }),
          ),
          showBottom ? el('div', { className: 'wb-divider' }) : null,
          showBottom
            ? el('div', { className: 'wb2-pane-bottom', style: { height: bottomH + 'px' } },
                el('div', { className: 'wb-tabbar', style: { padding: '4px 6px', borderBottom: '1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))' } },
                  VIEWS.map((v) => el('button', { key: v.id, className: cx('wb-tab', bottomTab === v.id && 'is-active'), onClick: () => setBottomTab(v.id) }, v.label)),
                  el('label', { className: 'wb-slider', title: '底部面板高度' }, '高',
                    el('input', { type: 'range', min: 120, max: 480, value: bottomH, onChange: (e) => setBottomH(Number(e.target.value)) })),
                  el('button', { className: 'wb-btn', onClick: () => setShowBottom(false) }, '隐藏'),
                ),
                el('div', { className: 'wb2-pane-top', style: { flex: '1 1 auto' } },
                  bottomTab === 'files' ? el(FilesPane, { root: cwd }) :
                  bottomTab === 'browser' ? el(BrowserPane, {}) :
                  el(GitPane, { cwd }),
                ),
              )
            : null,
        ),
      ),
    )
  }

  function FilesPane(props) {
    const { root } = props
    const [wsItems, setWsItems] = useState([])
    const [rootInput, setRootInput] = useState(root || '')
    const [rootPath, setRootPath] = useState(root || '')
    const [children, setChildren] = useState({})
    const [expanded, setExpanded] = useState({})
    const [selected, setSelected] = useState(null)
    const [editor, setEditor] = useState(null)
    const [image, setImage] = useState(null)
    const [err, setErr] = useState('')

    function reset() {
      setChildren({}); setExpanded({}); setSelected(null); setEditor(null); setImage(null); setErr('')
    }

    useEffect(() => {
      if (root) { setRootInput(root); setRootPath(root); reset() }
    }, [root])
    useEffect(() => {
      call('workspaces', {}).then((r) => { if (r && r.items) setWsItems(r.items) }).catch(() => {})
    }, [])

    async function loadRoot(p) {
      setErr('')
      try {
        const r = await call('list', { root: p, path: '.' })
        if (!r || r.ok === false) { setErr((r && r.error) || '读取失败'); return }
        setChildren((prev) => Object.assign({}, prev, { '': r.entries }))
      } catch (e) { setErr(String((e && e.message) || e)) }
    }

    useEffect(() => { if (rootPath) loadRoot(rootPath) }, [rootPath])

    async function toggleDir(rel) {
      const isOpen = !!expanded[rel]
      setExpanded((prev) => Object.assign({}, prev, { [rel]: !isOpen }))
      if (!isOpen && !children[rel]) {
        try {
          const r = await call('list', { root: rootPath, path: rel })
          if (r && r.ok !== false) setChildren((prev) => Object.assign({}, prev, { [rel]: r.entries }))
        } catch (e) {}
      }
    }

    async function openFile(entry, rel) {
      setSelected({ path: rel }); setImage(null); setErr('')
      const ext = rel.split('.').pop().toLowerCase()
      if (IMAGE_EXT.has(ext)) {
        try {
          const r = await call('readImage', { root: rootPath, path: rel })
          if (r && r.ok) setImage({ path: rel, dataUrl: r.dataUrl })
          else setErr((r && r.error) || '图片读取失败')
        } catch (e) { setErr(String((e && e.message) || e)) }
        return
      }
      try {
        const r = await call('readText', { root: rootPath, path: rel })
        if (r && r.ok) setEditor({ path: rel, content: r.content, saved: true })
        else if (r && r.tooLarge) setErr('文件过大：仅支持预览 ≤2MB 的文本')
        else setErr((r && r.error) || '读取失败')
      } catch (e) { setErr(String((e && e.message) || e)) }
    }

    async function saveEditor() {
      if (!editor || !rootPath) return
      try {
        const r = await call('writeText', { root: rootPath, path: editor.path, content: editor.content })
        if (r && r.ok) setEditor((prev) => (prev ? Object.assign({}, prev, { saved: true }) : prev))
        else setErr((r && r.error) || '保存失败')
      } catch (e) { setErr(String((e && e.message) || e)) }
    }

    function applyRoot() {
      const p = rootInput.trim()
      if (!p) return
      reset()
      setRootPath(p)
    }

    return el('div', { className: 'wb-files' },
      el('div', { className: 'wb-rootbar' },
        el('input', { className: 'wb-input', value: rootInput, placeholder: '工作目录（绝对路径）', onChange: (e) => setRootInput(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') applyRoot() } }),
        el('button', { className: 'wb-btn', onClick: applyRoot }, '载入'),
      ),
      wsItems.length
        ? el('div', { className: 'wb-wsrow' }, '工作区：',
            wsItems.map((w) => el('button', { key: w.path, className: 'wb-chip', onClick: () => { setRootInput(w.path); applyRoot() } }, w.title)))
        : null,
      err ? el('div', { className: 'wb-err' }, err) : null,
      el('div', { className: 'wb-split' },
        el('div', { className: 'wb-tree' },
          rootPath
            ? el(TreeNodes, { rel: '', depth: 0, entries: children[''] || [], childrenMap: children, expanded, rootPath, onToggle: toggleDir, onOpen: openFile, selected: selected ? selected.path : null })
            : el('div', { className: 'wb-hint' }, '输入目录并载入'),
        ),
        el('div', { className: 'wb-edit' },
          image ? el('div', { className: 'wb-preview' }, el('img', { src: image.dataUrl, alt: image.path })) :
          editor ? el(EditorPane, { editor, onContent: (c) => setEditor((p) => (p ? Object.assign({}, p, { content: c, saved: false }) : p)), onSave: saveEditor }) :
          el('div', { className: 'wb-hint' }, '选择文件查看 / 编辑'),
        ),
      ),
    )
  }

  function TreeNodes(props) {
    const { rel, depth, entries, childrenMap, expanded, onToggle, onOpen, selected } = props
    return el('div', { className: 'wb-treenodes' },
      entries.map((e) => {
        const childRel = rel ? rel + '/' + e.name : e.name
        const isDir = e.type === 'dir'
        const isOpen = !!expanded[childRel]
        return el('div', { key: childRel },
          el('div', {
            className: cx('wb-node', selected === childRel && 'is-selected'),
            style: { paddingLeft: (6 + depth * 12) + 'px' },
            onClick: () => (isDir ? onToggle(childRel) : onOpen(e, childRel)),
          },
            el('span', { className: cx('wb-caret', isOpen && 'is-open') }, isDir ? (isOpen ? '▾' : '▸') : '·'),
            el('span', { className: cx('wb-nm', isDir && 'is-dir') }, e.name),
          ),
          isDir && isOpen ? el(TreeNodes, { rel: childRel, depth: depth + 1, entries: childrenMap[childRel] || [], childrenMap, expanded, onToggle, onOpen, selected }) : null,
        )
      }),
    )
  }

  function renderMarkdown(src) {
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    let out = esc(src)
    out = out.replace(/```([\s\S]*?)```/g, (m, c) => '<pre><code>' + c + '</code></pre>')
    out = out.split('\n').map((line) => {
      const h = line.match(/^(#{1,6})\s+(.*)$/)
      if (h) return '<h' + h[1].length + '>' + h[2] + '</h' + h[1].length + '>'
      if (/^\s*[-*]\s+/.test(line)) return '<p>• ' + line.replace(/^\s*[-*]\s+/, '') + '</p>'
      if (line.trim() === '') return ''
      return '<p>' + line + '</p>'
    }).join('\n')
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    out = out.replace(/`([^`]+)`/g, '<code>$1</code>')
    return out
  }

  function EditorPane(props) {
    const { editor, onContent, onSave } = props
    const [preview, setPreview] = useState(false)
    const isMd = editor.path.toLowerCase().endsWith('.md')
    useEffect(() => { setPreview(false) }, [editor.path])
    return el('div', { className: 'wb-editor' },
      el('div', { className: 'wb-edithead' },
        el('span', { className: 'wb-filepath' }, editor.path),
        el('span', { className: 'wb-dirty' }, editor.saved ? '' : '未保存'),
        isMd ? el('button', { className: 'wb-btn', onClick: () => setPreview(!preview) }, preview ? '编辑' : '预览') : null,
        el('button', { className: 'wb-btn wb-primary', onClick: onSave, disabled: editor.saved }, '保存'),
      ),
      preview
        ? el('div', { className: 'wb-md', dangerouslySetInnerHTML: { __html: renderMarkdown(editor.content) } })
        : el('textarea', {
            className: 'wb-textarea', value: editor.content, spellCheck: false,
            onChange: (e) => onContent(e.target.value),
            onKeyDown: (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); onSave() } },
          }),
    )
  }

  function BrowserPane() {
    const [input, setInput] = useState('')
    const [stack, setStack] = useState([])
    const [idx, setIdx] = useState(-1)
    const [key, setKey] = useState(0)
    const url = idx >= 0 ? stack[idx] : null

    function normalize(u) {
      u = String(u || '').trim()
      if (!u) return null
      if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(u)) u = 'https://' + u
      if (/^(javascript|data|file):/i.test(u)) return null
      return u
    }
    function go(u) {
      const nu = normalize(u)
      if (!nu) return
      const next = stack.slice(0, idx + 1).concat([nu])
      setStack(next); setIdx(next.length - 1); setKey((k) => k + 1); setInput(nu)
    }
    function back() { if (idx > 0) { setIdx(idx - 1); setKey((k) => k + 1); setInput(stack[idx - 1]) } }
    function fwd() { if (idx < stack.length - 1) { setIdx(idx + 1); setKey((k) => k + 1); setInput(stack[idx + 1]) } }

    return el('div', { className: 'wb-browser' },
      el('div', { className: 'wb-navbar' },
        el('button', { className: 'wb-btn', onClick: back, disabled: idx <= 0 }, '←'),
        el('button', { className: 'wb-btn', onClick: fwd, disabled: idx >= stack.length - 1 }, '→'),
        el('button', { className: 'wb-btn', onClick: () => setKey((k) => k + 1), disabled: !url }, '⟳'),
        el('input', { className: 'wb-input', value: input, placeholder: '网址，如 example.com', onChange: (e) => setInput(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') go(input) } }),
        el('button', { className: 'wb-btn', onClick: () => go(input) }, '打开'),
        url ? el('a', { className: 'wb-btn wb-ext', href: url, target: '_blank', rel: 'noreferrer' }, '系统浏览器') : null,
      ),
      url
        ? el('iframe', { key, className: 'wb-iframe', src: url, sandbox: 'allow-scripts allow-forms allow-popups allow-downloads allow-modals' })
        : el('div', { className: 'wb-hint' }, '输入网址开始浏览。内容运行在沙箱 iframe：需登录或拒绝嵌入的站点可能无法显示，可点「系统浏览器」。'),
    )
  }

  function DiffView(props) {
    const { text } = props
    if (!text) return el('div', { className: 'wb-hint' }, '无差异')
    return el('pre', { className: 'wb-diff' },
      String(text).split('\n').map((line, i) => {
        const cls = line.startsWith('+') && !line.startsWith('+++') ? 'add' : line.startsWith('-') && !line.startsWith('---') ? 'del' : line.startsWith('@@') ? 'meta' : null
        return el('div', { key: i, className: cls ? 'wb-dline ' + cls : 'wb-dline' }, line || ' ')
      }),
    )
  }

  function GitRow(props) {
    const { entry, onDiff, onStage, onUnstage, onRestore } = props
    const [arm, setArm] = useState(false)
    useEffect(() => {
      if (!arm || !timerSvc) return
      const d = timerSvc.timeout(() => setArm(false), 3000)
      return d
    }, [arm])
    const code = entry.code || '  '
    const badges = []
    if (entry.staged) badges.push(el('span', { key: 's', className: 'wb-badge s' }, code[0]))
    if (entry.worktree) badges.push(el('span', { key: 'w', className: 'wb-badge w' }, code[1] === ' ' ? 'M' : code[1]))
    if (!entry.staged && !entry.worktree) badges.push(el('span', { key: 'u', className: 'wb-badge w' }, '?'))
    return el('div', { className: 'wb-git-row', onClick: () => onDiff(entry) },
      badges,
      el('span', { className: 'wb-git-path', title: entry.path }, entry.path + (entry.from ? ' ← ' + entry.from : '')),
      entry.staged ? el('button', { className: 'wb-git-act', onClick: (e) => { e.stopPropagation(); onUnstage(entry) } }, '撤销暂存') : null,
      entry.worktree ? el('button', { className: 'wb-git-act', onClick: (e) => { e.stopPropagation(); onStage(entry) } }, '暂存') : null,
      (entry.staged || entry.worktree) && code[1] !== '?'
        ? el('button', {
            className: 'wb-git-act',
            onClick: (e) => { e.stopPropagation(); if (arm) { setArm(false); onRestore(entry) } else { setArm(true) } },
          }, arm ? '确认还原?' : '还原')
        : null,
    )
  }

  function GitPane(props) {
    const { cwd } = props
    const [st, setSt] = useState(null)
    const [log, setLog] = useState([])
    const [sub, setSub] = useState('status')
    const [sel, setSel] = useState(null)
    const [staged, setStaged] = useState(false)
    const [diff, setDiff] = useState('')
    const [msg, setMsg] = useState('')
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState('')
    const [okMsg, setOkMsg] = useState('')

    async function refresh() {
      if (!cwd) return
      setBusy(true); setErr('')
      try {
        const [s, l] = await Promise.all([
          call('git.status', { cwd }),
          call('git.log', { cwd }),
        ])
        if (s && s.ok !== false) { setSt(s); setSel(null); setDiff('') }
        else setErr((s && s.error) || 'git status 失败')
        if (l && l.ok) setLog(l.commits)
      } catch (e) { setErr(String((e && e.message) || e)) } finally { setBusy(false) }
    }

    useEffect(() => { if (cwd) refresh() }, [cwd])

    async function loadDiff(entry) {
      if (!cwd) return
      setSel({ path: entry.path }); setStaged(false); setErr('')
      try {
        const r = await call('git.diff', { cwd, path: entry.path, staged: false })
        setDiff(r && r.ok ? r.diff : (r && r.error) || 'diff 失败')
      } catch (e) { setDiff(String((e && e.message) || e)) }
    }

    async function toggleStaged() {
      if (!sel || !cwd) return
      const next = !staged
      setStaged(next); setErr('')
      try {
        const r = await call('git.diff', { cwd, path: sel.path, staged: next })
        setDiff(r && r.ok ? r.diff : (r && r.error) || 'diff 失败')
      } catch (e) { setDiff(String((e && e.message) || e)) }
    }

    async function act(name, args, doneMsg) {
      if (!cwd) return
      setBusy(true); setErr(''); setOkMsg('')
      try {
        const r = await call(name, Object.assign({ cwd }, args))
        if (r && r.ok) { setOkMsg(doneMsg || '完成'); await refresh() }
        else setErr((r && r.error) || '操作失败')
      } catch (e) { setErr(String((e && e.message) || e)) } finally { setBusy(false) }
    }

    function commit() {
      const m = msg.trim()
      if (!m) return
      act('git.commit', { message: m }, '已提交')
      setMsg('')
    }

    return el('div', { className: 'wb-git' },
      el('div', { className: 'wb-gitbar' },
        el('button', { className: 'wb-btn', onClick: refresh, disabled: !cwd || busy }, busy ? '…' : '刷新'),
        st && st.branch ? el('span', { className: 'wb-git-meta' }, st.branch + (st.head ? ' @ ' + st.head : '')) : el('span', { className: 'wb-git-meta' }, cwd ? '非 Git 仓库?' : '无工作目录'),
      ),
      err ? el('div', { className: 'wb-err' }, err) : null,
      okMsg ? el('div', { className: 'wb-ok' }, okMsg) : null,
      el('div', { className: 'wb-git-sub' },
        el('button', { className: cx('wb-tab', sub === 'status' && 'is-active'), onClick: () => setSub('status') }, '状态'),
        el('button', { className: cx('wb-tab', sub === 'log' && 'is-active'), onClick: () => setSub('log') }, '历史'),
      ),
      sub === 'status'
        ? el(StatusTab, { st, sel, staged, diff, msg, onMsg: setMsg, onCommit: commit, onDiff: loadDiff, onToggleStaged: toggleStaged, onAct: act })
        : el(LogTab, { log }),
    )
  }

  function StatusTab(props) {
    const { st, sel, staged, diff, msg, onMsg, onCommit, onDiff, onToggleStaged, onAct } = props
    const rows = (st && st.entries) || []
    return el('div', { style: { display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 } },
      el('div', { style: { overflow: 'auto', flex: '0 1 auto', maxHeight: '40%', borderBottom: '1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))' } },
        rows.length === 0
          ? el('div', { className: 'wb-hint' }, '工作区干净 ✓')
          : rows.map((e) => el(GitRow, { key: e.path + e.code, entry: e, onDiff, onStage: (x) => onAct('git.stage', { path: x.path }, '已暂存'), onUnstage: (x) => onAct('git.unstage', { path: x.path }, '已撤销暂存'), onRestore: (x) => onAct('git.restore', { path: x.path }, '已还原') })),
      ),
      el('div', { style: { display: 'flex', gap: 4, padding: '4px 6px', flex: '0 0 auto' } },
        el('button', { className: cx('wb-tab', !staged && 'is-active'), onClick: onToggleStaged, disabled: !sel }, '工作区差异'),
        el('button', { className: cx('wb-tab', staged && 'is-active'), onClick: onToggleStaged, disabled: !sel }, '暂存区差异'),
      ),
      sel ? el(DiffView, { text: diff }) : el('div', { className: 'wb-hint' }, '点击文件查看 diff'),
      el('div', { className: 'wb-commitbar' },
        el('input', { className: 'wb-input', value: msg, placeholder: '提交信息…', onChange: (e) => onMsg(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') onCommit() } }),
        el('button', { className: 'wb-btn wb-primary', onClick: onCommit, disabled: !msg.trim() }, '提交'),
      ),
    )
  }

  function LogTab(props) {
    const { log } = props
    if (!log || log.length === 0) return el('div', { className: 'wb-hint' }, '暂无提交记录')
    return el('div', { className: 'wb-log', style: { flex: '1 1 auto' } },
      log.map((c) => el('div', { key: c.hash, className: 'wb-log-row' },
        el('span', { className: 'wb-log-hash' }, c.hash),
        el('span', { className: 'wb-log-sub', title: c.subject }, c.subject),
        el('span', { className: 'wb-log-date' }, c.date),
      )),
    )
  }

  function apply(ctx) {
    const slots = ctx.get('slots')
    if (!slots) return
    layoutSvc = ctx.get('layout')
    timerSvc = ctx.get('timer')
    const disposers = []
    ctx.effect(() => () => { for (const d of disposers) d() })

    const inj1 = slots.inject('conversation.session.header.utilities', () => {
      const d = slots.register({ name: 'conversation.session.header.utilities', id: 'wb.header', order: 10, label: () => '工作台' }, () => el(HeaderButton))
      if (d) disposers.push(d)
    })
    if (inj1) disposers.push(inj1)

    const inj2 = slots.inject('details', () => {
      const d = slots.register({ name: 'details', priority: -100 }, (props) => el(WorkbenchPanel, props))
      if (d) disposers.push(d)
    })
    if (inj2) disposers.push(inj2)
  }

  module.exports = {
    name: 'dsh-workbench-client',
    inject: ['slots'],
    apply,
  }
  return module.exports
} })
