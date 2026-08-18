# dsh-desktop

DSH Desktop（方案 C，mac 优先）：把 Electron 桌面壳做成一个 DeepSeek Harness
Cordis bundle。Electron 主进程直接 `boot()` Host Cordis root，`desktop-shell`
Host 插件读取 loopback web server 端口并调度原生窗口/托盘，桌面能力经
`ctx.desktopRuntime` 注入，第三方插件不接触 Electron API。

> 状态：Phase 0 已完成并跑通（单实例 + 窗口 + 托盘 + 兼容模式；
> Electron 主进程 in-process boot 验证通过；`desktopProfiles` service 骨架与
> 托盘「Profiles」子菜单已落地）。内置 pnpm、打包发布、内置终端属后续阶段。

## 架构

- `src/main.cjs` —— Electron 入口（CommonJS，`require('electron')` 才能拿到 app）：
  单实例锁 → 注入 `desktopRuntime` → `bootHost()` → 调度原生窗口。
- `src/runtime.cjs` —— Electron 运行时（CommonJS）：BrowserWindow / Tray / 退出。
- `src/host.js` —— 与 Electron 无关的 boot 逻辑：准备 `desktop` profile（缺失时
  初始化为 `dsh-base` + `dsh-web-app`）→ heal 模块 fallback → 在 `dsh-web-app`
  之后拼入桌面 patch 层 → `boot()`，注入 `desktopRuntime` / `launchEnvironment` /
  `cmdline`（`--host 127.0.0.1 --port 0`）。
- `src/module-resolution.js` —— 针对 Electron 主进程的 profile-relative 解析钩子：
  Electron 拿不到 Node 内部 ESM loader，Cordis Loader 回退到从自身位置 `import()`，
  此钩子把 Loader 的 bare 请求重定向到 profile manifest。
- `src/index.js` —— `desktop-shell` Host 插件：读取 `ctx.webServer.port`，
  调度原生窗口；无 `desktopRuntime` 时降级为 no-op。
- `src/profiles.js` —— 只读 profile 发现（`$DSH_HOME/profiles/*` 中声明
  `dsh.profile.bundles` 的目录）。
- `src/profile-service.js` —— 公开 contract：`desktopProfiles` 服务名。
- `cordis.patch.yml` —— 桌面 Host 操作层：insert `desktop-shell`。

## 依赖与打包要点

- `pnpm-workspace.yaml` 使用 `nodeLinker: hoisted` + `autoInstallPeers: true`：
  `healProfilesModuleFallback` 需要扁平 node_modules 才能 BFS 出完整依赖闭包，
  而 `@deepseek-ai/cordis`、`dsh-invariants` 等是 peer 依赖，必须显式装上。
- `node-addon-require-builtin` 提供无 `--expose-internals` 时的内部 loader 访问
  （仅 plain Node；Electron 主进程用上面的解析钩子）。
- 顶层 `productName: DSH Desktop` 避免与官方 `dsh-desktop` 应用共享 userData /
  单实例锁。
- 启动器 `scripts/bin.mjs` 会剥离 `ELECTRON_RUN_AS_NODE`（DSH host 会把它泄漏
  到子进程环境），否则 Electron 会以 Node 模式启动、拿不到 app。

## 开发运行

```sh
cd bundles/dsh-desktop
pnpm install
env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron .   # GUI（mac）
node scripts/bin.mjs                                        # 或走 dsh-desktop 启动器
```

首次运行会创建 `~/.dsh/profiles/desktop`。可用 `DSH_DESKTOP_PROFILE=<name>`
覆盖目标 profile；`DSH_DESKTOP_HEADLESS=1` 时创建并加载窗口但不显示、不建托盘
（无头冒烟用）。

## 无头验证

```sh
# 组合层冒烟：只校验 profile 组合与 desktop-shell 行挂载
DSH_HOME=/tmp/dsh-desktop-smoke node scripts/smoke-profile.mjs

# 完整 boot 冒烟：in-process boot + web server + desktop-shell 调度 + 拉取页面
DSH_HOME=/tmp/dsh-desktop-boot node scripts/smoke-boot.mjs

# Electron 无头冒烟：真实 Electron 主进程 boot（隐藏窗口）
DSH_HOME=/tmp/dsh-desktop-gui DSH_DESKTOP_HEADLESS=1 \
  env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron .
```

## 打包发布（Phase 2）

```sh
cd bundles/dsh-desktop
pnpm install
./node_modules/.bin/electron-builder --mac dir     # 先出未打包 .app 冒烟
./node_modules/.bin/electron-builder --mac dmg zip # 出 DMG + ZIP
```

产物在 `release/`（`mac-arm64/DSH Desktop.app`、`.dmg`、`.zip`）。

- `asar: false`：桌面壳需要在运行时读真实的 `node_modules`（heal 闭包、解析钩子），
  走真实文件系统，避免 asar 虚拟路径破坏 `createRequire`/`import.meta.resolve`。
- 未签名：本机构建无 Developer ID，macOS 首次打开需右键→打开，或 `xattr -dr
  com.apple.quarantine "DSH Desktop.app"`。
- 图标：暂用 Electron 默认图标；后续补 `build/icon.icns`。
- 共享语义：安装后的 app 与当前 DSH 共用 `~/.dsh`（会话/存储/凭据/profile 全共享），
  但与官方桌面 app 同跑同一 workspace 时会争用 `~/.dsh/sessions` 与 `storages`，
  不要同时运行。
