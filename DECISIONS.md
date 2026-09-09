# 决策记录（Decision Log）

本仓库的重要决策记录。新决策追加到末尾、编号递增；修改已采纳决策需同时更新状态与日期。

---

## D-001 仓库定位与形态

- **日期**：2026-08-17
- **状态**：已采纳（Adopted）
- **背景**：需要一个仓库作为 AI 助手（DeepSeek Harness）的个人插件集合，同时希望他人也能搜寻并按需取用。
- **决策**：
  - 仓库：`Siq5005/dsh-plugins`（公开）
  - 定位：插件集合仓库——归档 AI 自用插件，同时作为可搜寻、可按需取用的插件目录。
  - 内容组织：按类型分目录——`bundles/`（可安装组合包）、`skills/`（技能）、`tools/`（工具 / MCP）。
- **备选**：每插件独立仓库——多仓库维护成本高、开发期切换成本高，暂不采用（见 D-003 的演进路径）。

## D-002 开发工作流：直接在集合仓库内开发

- **日期**：2026-08-17
- **状态**：已采纳（Adopted）
- **背景**：写插件是"直接在集合仓库写"还是"写完独立仓库再关联进来"。
- **决策**：直接在集合仓库内开发，每个插件一个自包含子目录。
- **理由**：
  - DSH 的安装机制（`dsh plugin add <path>`，profile 存 `link:` 引用）不要求插件独立成库；
  - 一个 bundle 通常只有几个小文件（package.json + cordis.patch.yml + 入口模块），独立仓库 + submodule 的收益低、成本高；
  - 集合仓库天然承担"归档 + 随时拉取"职责，clone 一次即有全部插件。
- **例外**：插件需要独立版本号 / 独立发布 / 独立 License / 对外分享时，用 `git subtree split` 拆分为独立仓库（见 D-003 演进路径）。

## D-003 分发工作流：方案 A（单体仓库 + 目录索引 + 按需取用）

- **日期**：2026-08-17
- **状态**：已采纳（Adopted）
- **背景**：需要支持"他人在集合中搜寻 → 找到合适插件 → 只取这一个插件"的工作流。
- **决策**：
  1. **搜寻**：README 顶部维护插件目录表（面向人）+ `plugins.json` 机器可读索引（面向 AI / 自动化，schema 见 `plugins.schema.json`）。
  2. **只取一个插件，三条路**：
     - **a. 零 clone 直接安装（首选）**：`dsh plugin add "Siq5005/dsh-plugins#path:/bundles/<name>"`——`dsh plugin` 转发给 pnpm，pnpm（9+）支持从 git 仓库安装子目录，只取目标插件，不产生仓库副本。
     - **b. 源码级取用（稀疏克隆）**：`git clone --filter=blob:none --sparse` + `git sparse-checkout set bundles/<name>`，只下载目标目录的文件内容（cone 模式会连同根目录索引文件一并检出）。
     - **c. 免 git 取用**：`download-directory.github.io` 下载单目录 zip，或 `gh api repos/Siq5005/dsh-plugins/contents/bundles/<name>` 逐个取文件。
  3. **新增插件必须同步更新**：`plugins.json` 索引 + README 目录表。
- **演进路径（方案 C，需要时再启用）**：某插件需要独立版本 / 发布 / License 时，用 `git subtree split` 拆分为独立仓库，`plugins.json` 该条目的 `repo` 字段改指向独立仓库即可。A→C 平滑迁移，不推翻现有结构。
- **备选**：
  - 方案 B（一插件一仓库 + 集合仓库只做索引）：最正规，但多仓库维护成本高，暂不采用。

---

## 目录与索引约定

| 路径 | 内容 | 结构要求 |
|---|---|---|
| `bundles/<name>/` | 可安装组合包 | `package.json`（声明 `dsh.bundle`）+ `cordis.patch.yml` + 入口模块 |
| `skills/<name>/` | 技能包 | `SKILL.md` 等 |
| `tools/<name>/` | 独立工具 / MCP | 单文件或最小目录 |
| `plugins.json` | 机器可读索引 | 字段定义见 `plugins.schema.json`；新增插件必须更新 |

**新增插件标准流程**：
1. 在对应目录创建插件（参考 `bundles/hello-plugin` 模板）；
2. 本地验证：`dsh plugin --profile dev add ./bundles/<name>`；
3. 更新 `plugins.json` 与 README 目录表；
4. `git commit` + `git push` 归档。

---

## D-004 首个实际插件：复刻 dsh-dafeiyu（macOS 桌宠）

- **日期**：2026-08-17
- **状态**：已采纳（Adopted）
- **背景**：学习 `QCYTSN/dsh-dafeiyu`（大肥鱼桌宠插件）并复现一个作为集合第一个实际插件。
- **决策**：
  - 形态：macOS 桌宠窗口（PySide6 透明置顶）；核心链路优先，动画与交互简化。
  - 素材：沿用上游 `assets/pet/` PNG，许可状态与上游一致（**不在 MIT 内**，见 bundle 内 `ASSET_LICENSE.md`）；代码为自写复刻实现（结构参考上游，MIT）。
  - 实现：`bundles/dsh-dafeiyu-mac/`，三层架构——DSH JS 插件（Schema/settings/事件监听/reducer/helper 进程管理/协议）+ Python PySide6 渲染 + WebUI 设置卡片。
  - 验证：Node 测试 14/14 通过（含模拟 DSH ctx 冒烟测试与 headless 集成）；PySide6 可视化冒烟通过。
- **后续迭代（2026-08-17，同一天内完成）**：
  - 修复：角色未渲染（QLabel `adjustSize`）、无法拖动（去掉 `WindowDoesNotAcceptFocus`）、完成/出错动画无限循环（PULSE TTL 过期回落）。
  - 功能：气泡跟随角色缩放并自适应窗口高度；锁定模式（点击穿透，类似悬浮歌词）；记住窗口位置（`runtime/layout_store.py`，重启恢复 + 屏幕 clamp）；macOS 全桌面显示（NSWindow `CanJoinAllSpaces`）；隐藏 Dock 图标（accessory 激活策略）；移除空闲呼吸。
- **遗留（2026-08-17 更新）**：
  - ✅ 已清零：布局持久化、气泡跟随、锁定、全桌面、隐藏 Dock、动画回落、**helper 单文件打包**（见下）。
  - ✅ helper 单文件打包（2026-08-17）：PyInstaller onefile 构建为 `runtime/bin/darwin-arm64/dsh-dafeiyu-mac-helper`（约 39MB，含 PySide6 + pyobjc + assets），helper-process 自动优先使用打包二进制、无则回退 python3；构建脚本 `scripts/build-helper.sh` 可为本机平台重建；其他平台需自行构建。
  - ⏳ 仍遗留：**未实现走动动画与摸头/戳等轻互动**（素材齐备，动画逻辑未做）——已列入下个版本开发项。
- **注意**：本插件素材版权风险与上游相同，仅作学习复刻用途。

## D-005 第二个实际插件：dsh-deepseek-cost（对话费用统计）

- **日期**：2026-08-17
- **状态**：已采纳（Adopted）
- **背景**：需要看清当前对话按 DeepSeek 官方定价消耗了多少钱。
- **决策**：
  - 数据源：直接折叠会话日志中 provider 报告的 `assistant/message` usage（未缓存输入 / 缓存命中输入 / 缓存写入 / 输出），非估算。
  - 架构：注册自定义**会话投影** `tokenCost`（`sessionProjections.register`）——随日志重放、压缩/重启后仍准确，变更经 `session/projection` push 帧推给浏览器端，Client 用 `useProjection('tokenCost')` 零 RPC 读取；展示在官方统计行所在槽 `conversation.composer.dock`。
  - 计价：内置 DeepSeek 官方 V4 定价快照（人民币 / 百万 tokens），按请求时刻自动区分高峰 / 空闲时段（北京时间 9-12、14-18 点为高峰，空闲半价）。
  - 验证：Node 测试 32/32 通过（定价数学 / 投影折叠与替换语义 / 配置端点 / 插件冒烟）。
- **遗留（2026-08-17 更新）**：
  - ✅ **费用设置页 UI**（2026-08-17）：`settings.section` 新增「费用统计」页——DeepSeek 官方模型只读展示默认定价，其他模型填写 flat 三桶价（每百万 tokens 元），保存后**即时生效**（无需重启）。
  - 架构随之调整：**计价移出投影**——`tokenCost` 投影只存按模型 × 高峰/空闲分桶的纯 token 事实（stateVersion 2），价格由浏览器端读取 Host 设置命名空间（`/plugins/dsh-deepseek-cost/config` 端点）后即时折算；改价不重建投影、不丢累计。
  - ⏳ 仍遗留：官方模型定价仍为代码快照（官方调价需更新 `src/pricing.js`，改代码后重启生效）；自定义模型按 flat 价计费（不区分高峰/空闲）。

## D-006 第三个实际插件：dsh-workbench（右侧工作台）

- **日期**：2026-08-17
- **状态**：已采纳（Adopted）
- **背景**：需要文件浏览/编辑/预览 + 内嵌浏览器 + Git 面板的 VS Code 式工作台，先对比了上游实现再决定借鉴方向。
- **决策**：
  - 上游对比：`DSH-better-sidebar`（MIT，工作台全功能但右浮层遮挡对话、无 watcher）vs `dsh-web-ui/dsh-aionui-panel`（BSD-3/Apache-2.0，文件/Git 细节更精但无浏览器/终端）。**文件+Git 细节借鉴 aionui 方向，布局/浏览器借鉴 better-sidebar 方向**，代码全部自写。
  - **布局**：占 shell `details` 布局列（`layout.openDetails/closeDetails`），对话区收缩不遮挡；**取舍：替换内置「工具调用详情」右面板**。入口仅会话头部「工作台」按钮。
  - 数据层：host 经 `/dsh-workbench/*` HTTP 路由（`webServer.register`，loopback 围栏 + `fs.contains` 越界校验），client 用 `fetch`——静态 bundle 不走 `harness.handle/host.call`（那是动态插件机制）。
  - 形态：`bundles/dsh-workbench/`，host `src/index.js`（ESM）+ client `lib/client.js`（`window.__ModuleLoader__` 手写包），符合 D-001/D-002 的集合仓库规范；已装入 `web` profile。
  - 许可：MIT + 上游借鉴署名（better-sidebar MIT、aionui-panel BSD-3、AionUi）。
- **验证**：先以动态插件 8 个版本迭代调通（JSON 序列化、布局切换、入口可见性等），确认后固化为 bundle；`--dump-config` 确认挂载行。
- **遗留（转为以后迭代，非阻塞）**：文件名搜索、右键菜单（新建/重命名/删除/复制路径）、保存 mtime 冲突检测、SSE 变更流（fs watcher + git 轮询）——均为 aionui-panel 已有细节，作为以后迭代的增强方向，不影响当前版本使用。

## D-007 外部 npm 插件入索引（方案 C 应用：dsh-web-ui 全家桶）

- **日期**：2026-08-17
- **状态**：已采纳（Adopted）
- **背景**：本机 `web` profile（桌面端即用此 profile）安装了 dsh-web-ui 全家桶的三个插件——梁神模式（`@linxin666/dsh-liangshen`）、皮肤中心（`@linxin666/dsh-skins` + `@linxin666/dsh-client-ui-web-ui-settings`）、SSH 运维（`@linxin666/dsh-ssh`），均来自上游 [zhu1090093659/dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui)（npm 发布）。需要让"本仓库使用的插件"可被搜寻与复现安装。
- **决策**：
  - 外部插件**不入 bundles/ 复制代码**（跟随上游升级），以索引条目收录：`type: bundle` + `install` 写 npm 安装命令 + `repo` 指向上游仓库，**省略 `path`**（无仓库内路径）。
  - `plugins.schema.json` 相应放宽：`path` 从 required 改为可选（设置 `repo` 的外部包省略），描述注明"外部安装的包（设置了 repo）可省略"。
  - 皮肤中心的正确安装为两条命令（`dsh-skins` 提供皮肤 + 皮肤中心；`dsh-client-ui-web-ui-settings` 提供设置侧栏与 `web-ui.plugin.item` 槽位），`dsh-skins` 0.1.20 起 10 款皮肤内置包内，无需单独装皮肤包。
- **验证**：`--dump-config` 确认 `web-ui-skin-center` / `ui-web-ui-settings` 行挂载；桌面端重启后设置页出现皮肤中心。
- **备注**：dsh-ssh 的 ssh2 原生加密扩展在 Node 26 下编译失败，上游标注为可选、自动回退纯 JS 实现，功能不受影响。

## D-008 桌面实现转进 desktop-as-plugin（方案 C，Phase 0 骨架）

- **日期**：2026-08-18
- **状态**：已采纳（Adopted）
- **背景**：对比 `anywhere-labs/deepseek-harness-desktop`（社区「桌面即插件」产品）后，决定把我们的桌面实现从官方 minimal Electron 壳（`dsh-desktop` 0.0.1，单个 `main.cjs`）转进为 desktop-as-plugin 架构；用户确认走方案 C（搬架构 + 增量自建，mac 优先，保留自有实现与发布）。
- **决策**：
  - 新 bundle：`bundles/dsh-desktop/`（既是 Electron 可执行又是 DSH bundle：`main` 指向 Electron bootstrap、`exports["."]` 指向 `desktop-shell` Host 插件、`dsh.bundle.patch` 声明桌面操作层）。
  - 版本基准：**rc.6**（本机正在运行的版本），不 bump rc.7、不引 upstream submodule、不引入 Yarn workspace；已验证 rc.6 已含 `dsh-app-boot`（`boot/initProfile/healProfilesModuleFallback/loadProfile/loadOverlayPatches`）、`dsh-cmdline`（`provideCmdline`）、`dsh-launch-environment`（`DSH_LAUNCH_ENVIRONMENT_KEY`）、`dsh-home-paths`。
  - 启动方式：Electron 主进程直接 `boot()` Host Cordis root（不再 spawn 独立 `dsh web` 子进程）；`desktopRuntime` / `launchEnvironment` / `cmdline`（`--host 127.0.0.1 --port 0`）在 `boot()` 的 prepare 回调注入；`desktop-shell` 插件读 `ctx.webServer.port` 调度原生窗口。
  - 组合方式：桌面操作层（`cordis.patch.yml` 的 insert `desktop-shell`）由 launcher 在 `dsh-web-app` 层之后拼入，**不写入 profile 的 `dsh.profile.bundles`**（桌面是 app 本身，不是 profile bundle）。
  - profile：默认 `desktop`，缺失时 `initProfile` 初始化为 `dsh-base` + `dsh-web-app`；可用 `DSH_DESKTOP_PROFILE` 覆盖。
  - Electron 适配（关键坑）：入口改 CommonJS（`main.cjs` / `runtime.cjs`）——Electron 43 下 ESM `import {app} from 'electron'` 与 `require('electron')` 都会解析到 npm 包的路径字符串，只有 CJS main 的 `require('electron')` 拿到内置 API；顶层 `productName: DSH Desktop` 避免与官方 `dsh-desktop` 应用撞 userData/单实例锁；启动器剥离 `ELECTRON_RUN_AS_NODE`（DSH host 会泄漏到子进程环境，否则 Electron 以 Node 模式启动）。
  - 模块解析：`pnpm-workspace.yaml` 用 `nodeLinker: hoisted` + `autoInstallPeers: true`（`healProfilesModuleFallback` 需扁平闭包，`@deepseek-ai/cordis`/`dsh-invariants` 等是 peer）；`node-addon-require-builtin` 提供 plain Node 无 `--expose-internals` 的内部 loader 访问，但 Electron 主进程不可用（V8 embedder symbol 不匹配），故新增 `src/module-resolution.js` 解析钩子把 Cordis Loader 的 bare import 重定向到 profile manifest。
  - `desktopProfiles` service 骨架：`src/profiles.js` 只读发现；`current`（冻结快照）/`list`/`select` 经 `bootHost` 注入 `ctx.desktopProfiles`，`select` 落盘 `profile-selection/state.json` 后 `app.relaunch()`；托盘加「Profiles」子菜单（radio + 选择）；公开 contract `./profile-service`。
- **验证（Phase 0）**：
  - ✅ JS 语法检查通过（4 个源文件）。
  - ✅ `pnpm install`：rc.6 依赖 + electron 43.4.0 装齐（430 包）。
  - ✅ 无头冒烟 `scripts/smoke-profile.mjs`（`DSH_HOME=/tmp/...`）：`desktop` profile 组合成功，`desktop-shell` 行挂载（index 129，位于 `dsh-web-app` 全部行之后）。
  - ✅ 完整 boot 冒烟 `scripts/smoke-boot.mjs`（plain Node）：in-process boot + web server + `desktopProfiles` + `desktop-shell` 调度 + 拉取页面 200。
  - ✅ Electron 无头冒烟（`DSH_DESKTOP_HEADLESS=1` + `env -u ELECTRON_RUN_AS_NODE`）：真实 Electron 主进程 boot，日志 `[dsh-desktop] ready (profile: desktop)`，窗口创建并加载成功（隐藏）。
- **后续阶段**：Phase 1 多 profile 切换 + `desktopProfiles` service + 托盘选择器 / last-known-good；Phase 2 electron-builder 打包 + 内置 pnpm + 更新；Phase 3 内置 node-pty 终端 / advanced shell / Windows 特化（延后）。
- **注意**：`@deepseek-ai/dsh-subprocess-local` 等原生依赖的 build 脚本被 pnpm 忽略（`ERR_PNPM_IGNORED_BUILDS`），JS 依赖已装齐；若后续用到 subprocess / 终端再 `pnpm approve-builds`。

## D-009 费用统计 × 桌宠联动：桌宠气泡显示 DeepSeek 账号余额

- **日期**：2026-08-18
- **状态**：已采纳（Adopted）
- **背景**：已有 `dsh-deepseek-cost`（会话费用）与 `dsh-dafeiyu-mac`（桌宠）两个独立 bundle，需要在桌宠气泡处显示当前 API Key 账号余额，并复用费用插件的配置与密钥解析能力。
- **决策**：
  - 数据源：DeepSeek 官方 `GET /user/balance`（`Authorization: Bearer <DEEPSEEK_API_KEY>`），与当前配置的 DeepSeek base URL 一致（`DEEPSEEK_BASE_URL` 优先，缺省官方端点）；余额以 CNY 为首选币种。
  - 归属：余额拉取放在 `dsh-deepseek-cost`（新增 `src/balance.js`），通过 `ctx.provide('dshDeepseekBalance', service)` 暴露订阅式快照服务；`dsh-dafeiyu-mac` 用 `ctx.inject(['dshDeepseekBalance'])` 可选订阅，两个插件无静态 import 耦合。
  - 安全：API Key 仅由 Host 侧 `ctx.get('credentials').resolve('DEEPSEEK_API_KEY')` 解析，订阅方只收到 `{ status, totalBalance, currency, updatedAt }`，浏览器/桌宠进程不接触密钥；设置页与端点继续 loopback 围栏。
  - 展示：桌宠协议新增 `balance` 消息；`helper.py` 把余额合并进状态气泡最下面一行（不单独建气泡），成功显示 `余额 ¥xx.xx`，失败/关闭/无 Key 时清空该行。
  - 默认策略：余额获取**默认关闭**（公开仓库安装不自动请求外部接口）；本机 `web` profile 的 `cordis.patch.yml` 显式开启 `balanceEnabled: true`。
- **验证**：
  - ✅ `dsh-deepseek-cost` Node 测试 39/39 通过（新增余额解析 / 服务快照 / 配置补丁）。
  - ✅ `dsh-dafeiyu-mac` Node 测试 18/18 通过（新增 BALANCE 协议用例与余额联动格式化用例）；`python3 -m py_compile runtime/helper.py` 通过。
  - ✅ `pnpm dsh --profile web --dump-config` 确认 `dsh-deepseek-cost` 行挂载 `balanceEnabled: true` / `balanceRefreshMinutes: 15`。
- **遗留**：真实余额显示需重启 Web profile 后由 GUI 冒烟确认（桌面端当前运行实例不热更新）；余额接口失败仅静默降级，不做重试退避。

## D-010 桌面 Phase 2 打包：electron-builder + asar:false + 未签名 DMG

- **日期**：2026-08-18
- **状态**：已采纳（Adopted）
- **背景**：desktop-as-plugin 骨架（D-008）已在 mac 开发态跑通，需要产出可安装的 DMG/ZIP 给真实桌面验证。
- **决策**：
  - 打包：`electron-builder ^26.15.3` 写入 `bundles/dsh-desktop/package.json` 的 `build` 字段；`appId: ai.deepseek.dsh.desktop`、`productName: DSH Desktop`、mac 目标 `dmg`+`zip`、win 目标 `nsis`+`portable`（Windows 尚未验证）。
  - **`asar: false`**：桌面壳运行时需要读真实 `node_modules`（`healProfilesModuleFallback` 的 BFS + `createRequire`/`import.meta.resolve` 解析钩子），asar 虚拟路径会破坏这些；沿用官方 minimal 桌面的 `asar:false` 路线，牺牲单文件 asar 换取解析正确性。
  - `nodeLinker: hoisted`（D-008）让 electron-builder 直接打扁平 node_modules，无 `.pnpm` 重复体（.pnpm 仅 516K）；`electron` 在 devDependencies，构建时自动排除，`@electron/rebuild` 自动重编译 `node-pty`。
  - **peer 依赖必须显式声明**（关键坑）：pnpm 的 `autoInstallPeers` 装的是兄弟包、不在 `dependencies` 树里，electron-builder 不打包它们；首版 DMG 缺 `@deepseek-ai/cordis`/`dsh-invariants`/`cordis-plugin-group` 等导致启动即 `ERR_MODULE_NOT_FOUND`。修复：把 `node_modules/@deepseek-ai/*` 全量（199 个）+ `node-addon-require-builtin`/`react`/`react-dom`/`clsx` 显式写进 `dependencies`（镜像 anywhere-labs 做法）。
  - 未签名：本机无 Developer ID，产物未签名/未公证；用户侧首次打开需右键→打开或 `xattr -dr com.apple.quarantine`。
  - 图标：`build/icon.icns`（由用户提供 JPG 经 `sips -s format png` + `iconutil` 生成，1024² 8-bit RGB）+ `build/icon.png`；`mac.icon`/`win.icon` 已配置，构建产物 hash 与源一致。
- **验证**：
  - ✅ 未打包 `.app`（`release/mac-arm64/DSH Desktop.app`）无头冒烟：`[dsh-desktop] ready (profile: desktop)`，窗口创建并加载成功。
  - ✅ 产出 `release/DSH Desktop-0.1.0-arm64.dmg`（158MB）与 `-mac.zip`（171MB），`file` 校验为合法 zlib/zip。
  - ✅ 打包 `.app` 无头冒烟（补全 peer 后）：`[dsh-desktop] ready (profile: desktop)`；关键包 `cordis`/`dsh-invariants`/`cordis-plugin-group`/`react`/`react-dom`/`clsx` 均确认在 bundle 内。
- **共享语义**：安装后的 app 与现有 DSH 共用 `~/.dsh`（`sessions`/`storages`/`profiles`/`.credentials.yaml`/`settings.yaml` 全共享），因为 `resolveDshHome()` 默认 `~/.dsh`；与官方桌面 app 同跑同一 workspace 会争用 `~/.dsh/sessions` 与 `storages/session_projcache.json`，**不要同时运行**。
- **修复（agent-presets）**：`host.js` 的 `composeProfile` 起初漏了上游 `runProfile` 里的 `agent-presets` roots 注入，导致官方 shipped 预设（`code`/`cordis`/`minimal`/`standard`，位于 `@deepseek-ai/dsh/config/agent-presets/`）没被加载、只剩插件注册的 `liangshen`；已补 `composeEntries` + `SHIPPED_PRESET_ROOT` 注入，`smoke-profile` 验证 root 注入成功。
- **遗留**：签名/公证、Windows 产物验证、托盘真图标（当前 `nativeImage.createEmpty()` 占位）。

## D-011 右键菜单独立为 dsh-desktop-context-menu bundle

- **日期**：2026-08-18
- **状态**：已采纳（Adopted）
- **背景**：右键菜单最初实现在 `dsh-desktop/src/runtime.cjs` 的 `ElectronDesktopRuntime` 内；用户要求作为独立插件落库，避免桌面壳本体承担可选交互能力。
- **决策**：
  - 新建 `bundles/dsh-desktop-context-menu/`：CommonJS Host-only bundle（`dsh.bundle.patch`），入口 `index.cjs`。
  - 实现：在 Electron 主进程监听 `app` 的 `browser-window-created`，给每个 `BrowserWindow.webContents` 挂 `context-menu`，用 `Menu.buildFromTemplate` 弹原生菜单；普通 Node/Web profile 下 `process.versions.electron` 缺失自动 no-op。
  - 菜单项：可编辑区域剪切/复制/粘贴/全选；非编辑区域复制（有选中文本时）/全选；有导航历史时后退/前进。
  - 从 `dsh-desktop/src/runtime.cjs` 移除同款右键逻辑，桌面壳回归窗口/托盘/退出职责。
  - `plugins.json` 与 `README.md` 目录表同步登记；零 clone 安装 `dsh plugin --profile <name> add "Siq5005/dsh-plugins#path:/bundles/dsh-desktop-context-menu"`。
- **验证**：
  - ✅ `node --check index.cjs` 通过。
  - ✅ 临时 profile 组合验证：`desktop-context-menu` 行成功挂载（`@deepseek-ai/dsh-base` / `@deepseek-ai/dsh-web-app` / `dsh-desktop-context-menu`）。
  - ✅ 带该 bundle 的 `smoke-boot`：in-process boot + web server + `desktop-shell` 调度 + 页面 200。
- **遗留**：真实 Electron GUI 中的右键弹出与导航项启用状态需桌面端冒烟确认。

---

## D-012 方案 C 落地：dsh-desktop 拆分独立仓库

- **日期**：2026-08-18
- **状态**：已采纳（Adopted）
- **背景**：`dsh-desktop` 已越过 D-003 方案 C 的触发条件——独立版本（0.1.0）、electron-builder 独立发布（DMG/ZIP、appId/productName）、`install` 不再走 monorepo 的 `path:` 装法（改为 clone + 构建）。继续留在集合仓库会让目录索引与安装命令和其余 path-install bundle 不一致。
- **决策**：按 D-003 演进路径执行 A→C 迁移：
  1. 修 `bundles/dsh-desktop/README.md` 的 `cd bundles/dsh-desktop` → `cd dsh-desktop`（独立仓库布局）；
  2. `git subtree split --prefix=bundles/dsh-desktop --branch=split/dsh-desktop` 拆出干净历史（3 笔原提交 + 1 笔路径修正，前缀剥离）；
  3. 推为 `Siq5005/dsh-desktop` 仓库 main（`.gitignore` 已挡 `release/` 与 `node_modules/`，仅 3.46 MiB 源码 + 图标）；
  4. `plugins.json` 该条目：删除 `path`、`repo` 指向 `https://github.com/Siq5005/dsh-desktop`、`install` 改为 `git clone … && cd dsh-desktop && pnpm install && electron-builder --mac dmg`；
  5. README 目录表该行改标「bundle (独立仓库)」并指向新仓库。
- **完成（2026-08-18）**：新仓库 clone + `pnpm install` + `smoke-profile`/`smoke-boot` 全通过（desktop-shell 行挂载 index 129、in-process boot + 页面 200）；随后 `git rm -r bundles/dsh-desktop` 移除 monorepo 副本，索引统一经 `repo` 指向 `https://github.com/Siq5005/dsh-desktop`。DMG 打包未重跑——`electron-builder` 配置与 D-010 验证时一致（相对路径 `release/`/`build/`），拆分只改变仓库根路径。
- **备注**：`dsh-desktop-context-menu` 仍留 monorepo 按 `path:` 安装；其与 dsh-desktop 仅一条注释引用，无代码耦合，不构成阻塞。



## D-013 dsh-dafeiyu-mac 下个版本开发项：动画扩展（上游 PR #23）

- **日期**：2026-08-18
- **状态**：**已完成（2026-08-18）**——选择性移植（不等 PR 合并，改动独立于上游 main）
- **背景**：上游 `QCYTSN/dsh-dafeiyu` 的 PR [#23](https://github.com/QCYTSN/dsh-dafeiyu/pull/23)（作者 Serendipity-wu02，**开放中**）扩展桌宠动画系统：新增 searching（翻书查找 8 帧过程）、working 坐姿工作（seat_01~05 + 情绪帧）、enter/leave 出入场、question/answer 提问回答、dragging 拖拽细节等约 30 张新素材；并重写 animation_model / helper / reducer 等核心文件（约 3400 行 diff）。素材经确认协议为 **CC-BY-SA 4.0**。
- **决策**：
  1. 列入 dsh-dafeiyu-mac 下个版本开发项（与走动动画、摸头/戳互动同批）。
  2. **选择性移植**（2026-08-18 改）：PR 未合并，但用户要求直接动手；只移植素材/动画能力到我们自己的架构（PetWindow 已重构、可测试），不照搬其 5 文件重构（其基线为更新的 main）。
  3. 素材许可：CC-BY-SA 4.0，同步时需保留署名并遵守相同方式共享（已更新 `ASSET_LICENSE.md` 记录 PR #23 来源）。
  4. 追踪：GitHub issue/PR 订阅 REST API 已废弃（404），无法 API watch；按 PR URL 定期检查。
- **完成（2026-08-18）**：
  - 素材：拷贝 PR #23 全部新增帧（79 张 PNG）到 `assets/pet/`；`leave` 组素材 PR 未上传，从 manifest 移除（暂不做退场）；`dragging_238.png` 从 main 恢复（PR 误删）。
  - `animation_model.py`：Clip 增加 `scale` 字段；新增 `play_sequence` 场景序列（photoWall），非 loop clip 播完自动推进/回落。
  - `protocol.js` / reducer：新增 `QUESTION` 消息（提问文本下发气泡）；`isUserQuestionTool` 改为 **token 级匹配**（修复 #19 正则把 review/allow/permission 等普通工具误判为等待用户的问题）。
  - `helper.py`：场景序列播放（searching 翻书 / working 坐姿 / question 表情）、入场动画（enter）、空闲巡逻走动（窗口平移、不持久化位置）、双击戳/右键摸头、拖拽抓取/放下姿势、补全 think/work/wait/float motion、clip.scale 渲染。
  - 验证：离屏 8 项断言通过；真实窗口冒烟（翻书→坐姿→提问→待命）通过；JS 测试 20/20；helper 二进制重新打包（45MB）。
- **备注**：`leave`（退场）素材缺失，等上游补传或 PR 合并后再加；上游若合入 PR #23 的 5 文件重构，可再评估是否跟进其全部编排逻辑。
- **勘误（2026-09-08）**：本决策记录的「PR #23 开放中」已过期——PR #23 已于 **2026-08-22 关闭且未合并**（`merged_at=null`，改动保留在 Serendipity-wu02 的 fork 分支）。主线从不会吸收其 5 文件重构，`leave` 素材主线也始终未补。本地选择性移植被证实是正确路线，维持独立实现；素材层面本地 `assets/pet/`（PR #23 帧 + photoWall）已超主线，无需再照单同步主线素材。完整盘点见 D-020。

## D-014 版本基准升级：rc.6 → 0.1.2-rc.1（next 线）

- **日期**：2026-09-07
- **状态**：已采纳（验证结果见下，随升级提交回填）
- **背景**：本机启用 dsh-watcher 实时监督插件（peer 要求 `^0.1.2-rc.1`，README 的 rc.8 声明为旧文案）；linxin 插件 0.3.x 声明 `engines.dsh >= 0.1.2-rc.1` 并已装 0.3.17；官方 npm `next` 线即 0.1.2-rc.1。据此**修改 D-008 的 rc.6 基准**。
- **决策**：
  1. `dsh-desktop`（独立仓库）依赖整体从 `^0.1.0-rc.6` 切到 `^0.1.2-rc.1`：186 个 pin + 配对包（cordis `^4.0.2`、cordis-plugin-hmr `^1.0.17` 等）；**无 0.1.2-rc.1 的 14 个包按实际最新可用版本**（如 `dsh-client-runtime`→`0.1.1-rc.2`、`dsh-client-schema-form`/`dsh-client-web-react`→`0.1.0-rc.7`）。
  2. 保留 D-008/D-010 全部工程约束：`asar:false`、peer 显式写入 dependencies、共享 `~/.dsh`、electron-builder 打包、冒烟脚本。
  3. 0.1.2-rc.1 适配点（已验证并修复）：`healProfilesModuleFallback` 变异步对象参数 `{ installAnchor, profile, home }` 且需在 `loadProfile` 之后调用；Web 根路径新增 launch-token 鉴权（`connection.authenticatedUrl()` 签发 `?token=`，303→cookie 握手），桌面壳窗口 URL 需带 token、cmdline 需 `--no-open` 防弹系统浏览器。
  4. `web` profile：linxin 套件升 `dsh-ssh`/`dsh-liangshen`/`dsh-client-ui-web-ui-settings` `^0.3.17`、`dsh-skins` `^0.2.9`；新增 `dsh-watcher`（github:aa2246740/dsh-watcher）。
  5. 本地四个 bundles（dafeiyu-mac / deepseek-cost / vision-adapter / workbench）在 0.1.2-rc.1 下回归；`dsh-vision-adapter` 的 host peer 仍为 `^0.1.0-rc.6`，必要时连同其实现一起升级。
- **验证**（2026-09-07）：
  - ✅ `pnpm install` 全套（919 包解析）；`smoke-profile`（desktop-shell 行 index 145 + agent-presets 注入）；`smoke-boot`（in-process boot + token 握手 + 200 HTML）；**Electron 无头冒烟 `[dsh-desktop] ready (profile: desktop)`**。
  - ✅ profile `--dump-config` 578 行：watcher / ssh / workbench / skins / liangshen / 四个本地 bundle / base / web-app 全部挂载。
  - ⏳ GUI 重启后回归：watcher 眼睛可用、linxin 0.3.17 正常、四个本地 bundle 行为、旧会话数据无损（结果回填本节）。
- **遗留/风险**：Electron 二进制保持 43.4.0（只换 `Resources/app` 内容层）；若 0.1.2-rc.1 web frontend 布局/行为变化较大，桌面窗口尺寸与托盘交互需回归；预览期 API 仍可能漂移，`dsh-desktop` 的薄适配层（host.js/index.js）为后续变更的唯一触点。升级过程保留 `~/dsh-upgrade/backup-app-rc6/` 回滚材料。

## D-015 插件针对新核心的兼容层机制：pnpm patch + 真实 web profile 门槛

- **日期**：2026-09-07
- **状态**：已采纳（实施完成，见验证）
- **背景**：D-014 升级落地后，应用启动即崩溃——`@deepseek-ai/dsh-settings@0.1.2-rc.1` 删除了 `installSettingsSection` / `settingsNamespace` 两个导出（改为 `settings.installSection()` 方法），而 `@linxin666/dsh-client-ui-skin-center@0.2.9`（经 `dsh-skins` patch 间接引入，`engines.dsh` 虚标 `>=0.1.1-rc.1`）仍在 `import ... from "@deepseek-ai/dsh-settings"` 引用它们，ESM 链接期 SyntaxError 炸掉整个 boot。旧 swap 脚本自检只跑了**隔离 DSH_HOME 的 desktop profile**，未覆盖真实 web profile，因此没拦住。
- **决策**：
  1. **兼容层走 pnpm patch 固化**（不升级、不禁用任何插件）：在 web profile 对 `dsh-client-ui-skin-center@0.2.9` 打 patch——新增 `lib/settings-compat.js`（`settingsNamespace` 恒等；`installSettingsSection` 桥接到 `sctx.settings.installSection(ctx, ns, schema, entry, hooks)`），并改 `lib/index.js` 首行导入到本地 shim。通过 `pnpm patch`/`pnpm patch-commit` 记录进 `pnpm.patchedDependencies`（package.json + pnpm-lock.yaml，带内容 hash），重装/恢复可自动重放；禁止再手改 `node_modules`。
  2. **升级门槛覆盖真实 web profile**（防再犯）：`dsh-desktop` 仓库新增 `scripts/smoke-web-profile.mjs`——用**真实 ~/.dsh 的 web profile** + 当前核心做无头 boot，断言 launch-token 握手后根页 200（任何插件 client bundle 链接错误都会在此暴露）。`~/dsh-upgrade/swap-app.sh` 升级为：**0/5 预检**（新核心 + 真实 web profile 可 boot 才允许替换）→ 备份 → 替换 → 隔离桌面冒烟 → **4/5 复检**（替换后副本再 boot 真实 web profile）→ 失败自动回滚。
  3. 全 profile 扫描确认：skin-center 是唯一旧 settings API 消费者（web-ui-settings/liangshen/ssh/skins 与本地 bundles 均无 `installSettingsSection`/`settingsNamespace` 直接引用）。
- **验证**（2026-09-07）：
  - ✅ `pnpm patch-commit` 固化（lockfile `patchedDependencies` hash `8843d8…`；manifest 同步记录；`pnpm install` 无漂移）。
  - ✅ `smoke-web-profile` 实跑真实 web profile：`[my-plugins/dsh-watcher] loaded`、token 握手 303→cookie→200（27KB HTML）、全部插件 client bundle 干净链接。
  - ✅ swap 脚本 0/5 预检等价命令实测 PASS；`bash -n` 通过。
- **维护/上游跟踪**：`linxin` 上游若发版改用 `settings.installSection()`，更新 `dsh-skins` 版本后**需同步移除本 patch**（`pnpm.patchedDependencies` 按 `name@version` 精确匹配，版本一变 patch 自动失效，届时按「先跑 `smoke-web-profile` 再移除」流程处理）。新核心再次改名 settings API 时，同一机制（patch + 真实 profile 门槛）复用。

## D-016 dsh-sandbox same-mode 幂等修复固化（pnpm patch，随 dsh-desktop 仓库归档）

- **日期**：2026-09-07
- **状态**：已采纳（实施完成，见验证）
- **背景**：2026-08-22 诊断（`docs/dsh-codex-terra-bash-diagnosis.md`，Codex Terra/Sol 路由的 bash 工具参数携带与会话当前模式相同的 `sandbox_permissions: danger-full-access`，`dsh-sandbox` 严格校验按"未更宽"拒绝，导致 Codex 路由 bash 未执行即失败）后，当时**手改**了运行中 app 内 `@deepseek-ai/dsh-sandbox/lib/index.js`。该手改属"写在 node_modules、重装即丢"的临时修复；D-014 升级换核后已被冲掉（0.1.2-rc.1 pristine 无此逻辑）。
- **决策**：
  1. 在 `dsh-desktop` 仓库用 `pnpm patch` 对 `@deepseek-ai/dsh-sandbox@0.1.2-rc.1` 固化该修复：`approveEscalation` 中 `mode === effectiveMode` 时**幂等返回 effectiveMode**（same-mode 非升级，不进审批、不抛错），其余更宽升级路径保持不变；补丁文件 `patches/@deepseek-ai__dsh-sandbox@0.1.2-rc.1.patch` + `pnpm.patchedDependencies` 随仓库提交，重装/换核自动重放。
  2. 诊断文档规范化（原文件为单行字面 `\n`）并归档到 `dsh-desktop/docs/dsh-codex-terra-bash-diagnosis.md`，随补丁同仓记录。
  3. swap 工具归档：`~/dsh-upgrade/swap-app.sh` 的可移植版收录为 `dsh-desktop/scripts/upgrade-app.sh`（REPO 由脚本位置推导、APP_PATH/DSH_UPGRADE_BACKUP 可覆盖、保留 0/5 预检与 4/5 复检门槛）。
- **验证**（2026-09-07）：✅ repo `pnpm install` 无漂移、安装副本含幂等逻辑；✅ 补丁文件为规范 git diff；✅ `upgrade-app.sh` `bash -n` 通过；✅ 运行中 app 的 `node_modules/@deepseek-ai/dsh-sandbox` 已同步补丁文件（**下次宿主重启生效**，本决策不影响当前已加载模块与既有权限语义——幂等分支只豁免"请求模式 == 当前模式"，不放大权限阶梯）。
- **语义/安全说明**：幂等分支不改变升级阶梯（`WIDER_MODES`）与审批路径，仅把"要求与现状相同的模式"从报错改为无操作返回；不授予任何额外访问。
- **集合仓库归档**：补丁副本同步归档到本仓库 `patches/@deepseek-ai__dsh-sandbox@0.1.2-rc.1.patch`（含 `patches/README.md` 说明），权威应用位置为 `dsh-desktop` 的 `patches/` + `pnpm-workspace.yaml`。

## D-017 dsh-deepseek-cost 计费行显示修复：固定深色 + 允许换行

- **日期**：2026-09-07
- **状态**：已采纳（实施完成，见验证）
- **背景**：升级 0.1.2-rc.1 + dsh-skins 0.2.9 后，composer.dock 计费行出现：① 内容只显示前段——原样式 `whiteSpace:nowrap + overflow:hidden + textOverflow:ellipsis` 用在 **flex 容器**上，`text-overflow` 对 flex 容器不生效，dock 变窄时内容被硬截断（用户确认非磨砂覆盖，背景场景实际关闭）；② 部分皮肤下 `--dsw-alias-label-primary` 对比度不足看不清（用户要求固定为黑色）。
- **决策**：`bundles/dsh-deepseek-cost/lib/client.js` 的 `ROW_STYLE`：`flexWrap:'wrap'` 并移除 `minWidth/whiteSpace/overflow/textOverflow`（允许换行，随内容高度自动扩展）；`color` 从主题 token 改为固定 `#111`（近黑）；`justifyContent:'center'` 居中（槽内全宽后内容不再左对齐）。
- **验证**：`node --check` 通过；最终经 D-018/D-019 一并确认后用户验收：费用行完整、居中、黑色、可换行。**注意**：本决策的样式改动在 D-018（投影 wire）修复前因"费用行未渲染"而不可见，实际生效以 D-018 之后为准。
- **遗留/权衡**：固定黑色在**深色/暗色皮肤**下可读性会下降；后续可加设置项（跟随 token / 固定深色 / 固定浅色）替代硬编码。设置页（settings.section）保持主题 token 不变。

## D-018 dsh-deepseek-cost 费用行不可见的根因修复：投影 wire 契约（0.1.2-rc.1）

- **日期**：2026-09-07
- **状态**：已采纳（实施完成，用户确认费用行出现）
- **背景**：升级 0.1.2-rc.1 后费用行完全不显示。排查链：服务端 config 端点 200、宿主投影注册表含 tokenCost、真实事件上折叠与 view 均产出非空数据、客户端 `useProjection('tokenCost')` 却恒为 undefined。经比对 `dsh-session-stats`（工作正常）与宿主驱动源码定位：**0.1.2-rc.1 的投影契约要求定义带 `wire: { viewSchema, view }`**——宿主 `values()`/帧推送/缓存快照全部只认 `def.wire`，旧版裸 `view`/`schema` 字段被忽略；缺 `wire` 的投影不进 tail 投影块与 `session/projection` 帧，客户端视为"能力缺失"。此前所有颜色/换行修改"看不到效果"，是因为费用行元素从未被渲染（数据未送达），而非样式问题。
- **决策**：`src/cost-projection.js` 的 `createTokenCostProjection()` 增加 `wire: { viewSchema: tokenCostSchema, view(state) }`（将原 `view` 移入 wire，viewSchema 用既有 tokenCostSchema）；host 侧源码生效、无需构建。
- **验证**：ESM 语法通过；用真实 318 步会话跑 `apply → wire.view → viewSchema.parse`，输出 `deepseek-v4-flash: 303680 output tokens`；重启后用户确认费用行（黄底诊断标记）**出现**。随后移除黄底/红框临时标记，恢复 D-017 正式样式。
- **备注**：D-017 的"看不到效果"结论修正为"未渲染"；原生统计行（StatsLine）截断是独立的核心布局问题，在 D-019 中一并解决。

## D-019 composer.dock 槽行布局定稿：官方统计行截断修复 + 费用行样式收口

- **日期**：2026-09-07
- **状态**：已采纳（实施完成，用户最终验收通过）
- **背景**：D-018 后费用行可见但仍有布局问题：① 官方统计行（StatsLine，与费用行同槽）被容器强行单行裁剪，长行只显示前半段；② 槽内元素全宽后费用行内容左对齐（不居中）；③ 官方统计行在 13px 下内容超出可视宽度。
- **决策**：
  1. `lib/client.js` 客户端 `apply` 注入**仅作用于 `conversation.composer.dock` 槽**的 `<style>`：`display:flex; flex-wrap:wrap; justify-content:center; overflow:visible`，槽内子元素 `width/max-width:100%; white-space:normal; overflow-wrap:anywhere`——放开被容器强制的单行裁剪（StatsLine 自身 CSS 为 width:100% 且无 nowrap，本意允许换行）。不影响其它区域。
  2. 槽内首个子元素（官方统计行）字号压到 12px，尽量一行完整摆放，超宽时自然折行兜底。
  3. 费用行 `ROW_STYLE` 加 `justifyContent:'center'` 恢复居中。
- **验证**：用户重启后确认：官方统计行完整显示（12px 单行）、费用行完整居中黑色、两者布局稳定；**问题完全修复，最终验收通过**。
- **说明**：该覆盖样式随 dsh-deepseek-cost 插件注入；若核心后续修复 dock 容器布局，可移除注入（保持"先跑真实 web profile 门槛"的回归习惯）。

## D-020 上游 QCYTSN/dsh-dafeiyu 同步盘点：PR #23 关闭未合并 + 已合并功能差距清单

- **日期**：2026-09-08
- **状态**：已采纳（盘点落库；A 组作为 dsh-dafeiyu-mac 下个版本开发项）
- **背景**：用户要求（1）更新 decision 中过时的上游跟踪状态；（2）排查上游自本地快照（2026-08-17/18，v0.1.0-alpha.11 前后）以来**已合并**但本地复刻缺失的 PR。上次上游跟踪记录是 D-013（2026-08-18，记 PR #23「开放中」）。2026-09-08 实测上游现状：main HEAD `f4f4482` = **release v0.1.9**（09-05 发布），其后无新提交；stable 线已从 alpha.11 走到 v0.1.9（中间 0.1.0 稳定化、0.1.2/0.1.3 于 8/17–8/22 之间发布，明细以[上游 CHANGELOG](https://github.com/QCYTSN/dsh-dafeiyu/blob/main/CHANGELOG.md) 为准）。
- **上游现状要点**：
  1. 开放 PR 为空（`pulls?state=open` = `[]`）；开放 issue 2 个：[#39](https://github.com/QCYTSN/dsh-dafeiyu/issues/39)（依赖缺失/WSL 卡死，0.1.7/0.1.8 已部分缓解）、[#22](https://github.com/QCYTSN/dsh-dafeiyu/issues/22)（4K/高 DPI 素材、60FPS、settings 槽 key 校验——后者本地早已适配）。
  2. **PR #23（动画扩展）已于 2026-08-22 关闭且未合并**——勘误见 D-013。
  3. 未合并社区 PR（设计参考，不跟进）：[#64](https://github.com/QCYTSN/dsh-dafeiyu/pull/64) 3D 虎鲸（Electron+Three.js 渲染层）、[#60](https://github.com/QCYTSN/dsh-dafeiyu/pull/60) 设置卡片适配 PluginCard UI。
- **已合并功能差距清单**（对照本地 dsh-dafeiyu-mac 源码逐一核实；范围 = 快照后合并的 alpha.12 → v0.1.9）：
  - **A 组：缺失 → 列入下个版本开发项**
    1. **启动健壮性双护栏**（0.1.7 [#62](https://github.com/QCYTSN/dsh-dafeiyu/pull/62) import 期缺依赖优雅降级 + 0.1.8 [#65](https://github.com/QCYTSN/dsh-dafeiyu/pull/65) 激活失败不拖死 DSH boot）：本地 `apply`/`mount`、`settings.watch` 回调、session 事件监听均无异常包裹；参照 D-015（宿主 API 漂移曾整树崩溃）教训，采纳价值最高。注：import 期护栏需把顶层 schemastery 依赖改为惰性加载（`Config` 目前是模块作用域），比激活期包裹工作量更大。
    2. **reasoning effort 状态显示**（0.1.6 [#43](https://github.com/QCYTSN/dsh-dafeiyu/pull/43)/[#53](https://github.com/QCYTSN/dsh-dafeiyu/pull/53)）：气泡显示本请求实际生效的推理档位并跨 thinking/tool/waiting 保持；本地 reducer/helper/client 无 effort 概念（grep 零命中）。前置：实测宿主事件里 effort 字段形态。
    3. **拖拽反应序列**（0.1.6 [#45](https://github.com/QCYTSN/dsh-dafeiyu/pull/45)→[#52](https://github.com/QCYTSN/dsh-dafeiyu/pull/52) 整合 + [#55](https://github.com/QCYTSN/dsh-dafeiyu/pull/55) macOS 对齐）：release/dizzy/protest 反应序列、reduced-motion 降级、被抓取可打断；本地仅抓取/放下两姿势，且 manifest 已有 `dragging_cry`/`dragging_landed`/`error_dizzy` 素材**未接线**——移植成本低。
    4. **完成/出错反馈**（0.1.0-alpha.10 [#12](https://github.com/QCYTSN/dsh-dafeiyu/issues/12) + 0.1.3 原创 chime 与 notification-sound 设置）：成功/错误 PULSE 时窗口晃动 + 提示音；本地 PULSE 仅换气泡文案（shake 仅是 clip motion）。
    5. **helper 重启有界**（0.1.0-alpha.14 + 0.1.5 [#40](https://github.com/QCYTSN/dsh-dafeiyu/pull/40)）：`maxStartFailures` 上限，坏 helper 不再无限重启；本地 `#scheduleRestart` 无界（仅 CLOSED/stopping 抑制）。
    6. **项目名重命名新鲜度**（0.1.2）：live cwd/step projectName 优先于 session header；本地 `projectNameOf` 仍 header 优先 → 项目改名后气泡可能显示旧名。
    7. **宿主总线/客户端故障隔离**（0.1.0-alpha.15）：session 监听与 settings 卡片注册各自包 guard，坏事件/槽位契约变化只影响桌宠自身；本地监听裸跑、client `apply` 直接注入槽未包 guard。
    8. **pluginVersion 读 package.json**（0.1.0-alpha.13）：本地 HELLO 仍硬编码 `'0.1.0'`（`src/index.js`），版本提升后会漂移（微修）。
  - **B 组：可选（按平台/需求取舍）**
    1. 气泡显示模式 Always/Hidden/Custom（0.1.0-alpha.11，快照同日发布的边界项）：本地气泡常显；mac 场景价值待定。
    2. 右键菜单扩展（0.1.0-alpha.10 #12 + 0.1.3）：打开 WebUI、角色/气泡/reduced-motion 直接改并写回 settings、55–140% + 60% mini 预设；本地菜单仅「摸摸头 / 戳一戳 / 退出大肥鱼」。
    3. 多任务状态卡（0.1.0-alpha.10 #12）：多 DSH 会话时列出全部运行任务；本地 reducer 已有优先级选 top-1 基础，扩展成列表为中等成本。
    4. macOS 原生 Swift/AppKit universal helper（0.1.4 [#37](https://github.com/QCYTSN/dsh-dafeiyu/pull/37) + 0.1.7 [#58](https://github.com/QCYTSN/dsh-dafeiyu/pull/58) 可重复 Swift 测试）：本地 Python/PySide6 路线继续；Swift 动画/布局状态机测试思想可参考。x86_64 打包仍为本地已知限制。
  - **C 组：已覆盖或不适用（无需动作）**
    - ✅ EPIPE 吞错与宿主进程保护（alpha.15）——`helper-process` stdin/send 已处理（另见既有 EPIPE 修复提交）
    - ✅ `settings.plugin.item` keyed slot（alpha.12 契约）——client.js 已带 `key`
    - ✅ approval 审批等待（alpha.13）——reducer `approval/asked|decided` → WAITING
    - ✅ tool/result call-id 清除与用户提问等待（alpha.8）——`toolCallIdOf` 多路径 + token 级 `isUserQuestionTool`
    - ✅ thinking 流式 chunk 不闪文案（alpha.8）——签名去重
    - ✅ 拖拽稳定/抓取原子切换/走动终止（alpha.9）——本地已实现
    - ✅ includeSubagents 默认关闭、顶层任务优先（alpha.7 起）——同款设置
    - ✅ 心跳/快照重放/随宿主退出/reduced-motion（alpha.6 基线）——同款
    - ➖ Win32 手套光标（0.1.9 [#33](https://github.com/QCYTSN/dsh-dafeiyu/pull/33)）——Windows-only
    - ➖ WSL 相关（alpha.10/#8/[#51](https://github.com/QCYTSN/dsh-dafeiyu/pull/51)）——Linux/WSL 场景
    - ➖ macOS Gatekeeper 实测文档（0.1.7 [#63](https://github.com/QCYTSN/dsh-dafeiyu/pull/63)/#24）——分发文档类，本地 helper 自建可参考
    - ➖ CI/仓库清理（[#57](https://github.com/QCYTSN/dsh-dafeiyu/pull/57)/[#59](https://github.com/QCYTSN/dsh-dafeiyu/pull/59)/#54/#56）——工程内部
- **决策**：
  1. A 组 8 项列入 dsh-dafeiyu-mac 下个版本开发项，建议顺序 1/3/5/7（健壮性、低风险）→ 2/6（需先实测宿主事件字段）→ 4/8。
  2. B 组按用户取舍后另行立项；C 组不动作。
  3. 素材同步纪律：本地素材已超主线（PR #23 帧 + photoWall，署名已入 ASSET_LICENSE.md），此后**不再照单同步主线素材**，只按差距清单选择性采纳能力；`leave` 素材主线未补，不再等待，退场动画如需则自建或自 fork 分支取。
  4. 勘误 D-013 的 PR #23 状态（见该节补记）。
- **⏳ 待开发项目（D-020 采纳，下个版本回填式清单；实施顺序见决策 1，完成逐条回填到对应 DECISIONS 条目，先例 D-013）**：
  - [x] **A1** 启动健壮性双护栏——激活/`settings.watch` 异常包裹（#62/#65）——✅ 2026-09-08，`src/index.js` 激活护栏 + watch 回调包裹，`test/activation-guard.test.js` 3 项；import 期 schemastery 惰性加载未做（工作量独立，仍列为将来项）
  - [ ] **A2** reasoning effort 状态显示——气泡显示实际生效推理档位（#43/#53；先实测宿主事件字段）
  - [x] **A3** 拖拽反应序列——release/dizzy + reduced-motion 降级 + 可打断（#45→#52/#55）——✅ 2026-09-08，`animation_model.py` `drag_grab/drag_release`（纯逻辑）+ `helper.py` 鼠标事件接线，`runtime/test_drag_reaction.py` 6 项
  - [ ] **A4** 完成/出错反馈——PULSE 窗口晃动 + 提示音/通知设置（alpha.10 #12 + 0.1.3）
  - [x] **A5** helper 重启有界——maxStartFailures 上限（alpha.14 / 0.1.5 #40）——✅ 2026-09-08，`helper-process.js` 连续失败计数（READY 清零、READY 前退出/spawn error 计次），`test/bounded-restart.test.js` 2 项
  - [ ] **A6** 项目名重命名新鲜度——live cwd/projectName 优先于 header（0.1.2）
  - [ ] **A7** 宿主总线/客户端故障隔离——session 监听与 client 槽注册各自包 guard（alpha.15）
  - [ ] **A8** pluginVersion 读 package.json——去掉硬编码 `'0.1.0'`（alpha.13）
  - **落地回填（2026-09-08，健壮性批次）**：A1/A3/A5 已实现并提交 main——`a190c75`（A1）、`5fcb828`（A5）、`6c82abf`（A3）；验证：JS 全套 27/27（含新增 5 项）、Python 单测 6/6、`helper.py --headless` 启动干净退出。⚠️ A3 改动在 Python 侧，桌面生效需 `bash scripts/build-helper.sh` 重建 helper 单文件（另行处理）；A1 的 import 期惰性加载与 A7 事件监听隔离尚未做（A7 与 A1 部分重叠，见清单）。
  - B 组（可选，未立项，待取舍）：B1 气泡显示模式 / B2 右键菜单扩展（打开 WebUI + 设置写回 + mini 预设）/ B3 多任务状态卡 / B4 Swift/AppKit 原生 helper 参考
- **遗留/风险**：清单核实基准为上游 main（09-05 v0.1.9）与本地源码现状；宿主 0.1.2-rc.1 事件字段是否携带 effort/最新 cwd 需在实施 A-2/A-6 前实测；上游无 API watch 手段（D-013 已验证订阅 API 404），后续按版本/PR URL 人工周期性复核。

## D-021 dsh-vision-adapter 适配 0.1.2-rc.1 两处 API 漂移 + 视觉端点切官方 vision-exp

- **日期**：2026-09-08
- **状态**：已采纳（实施完成；代码 58/58 测试通过，配置实测生效）
- **背景**：D-014 升级 0.1.2-rc.1 后 GUI 重启回归（D-014 遗留项）暴露 dsh-vision-adapter 实际不可用，用户症状：贴图后模型无法分析图片；直接选 vision 模型报 `registration.adapter.prepareCall is not a function`；autoCaption 开启时发图卡死/响应极慢。逐层实测定位到三件事：
  1. **会话事件 API 漂移**：核心 `Session` 删除公开 `.events` 数组 getter（rc.6 有 `get events()`），改由 `snapshotEvents()`（全量冻结数组，语义等同旧 `.events`）或 `ownEvents()` 提供；插件 `analyze_image` 仍读 `exec.agent.session.events` → 恒 undefined → `VISION_OTHER 无法访问会话事件日志`，任何图都解析不了。
  2. **LlmAdapter 契约新增 `prepareCall`**：0.1.2-rc.1 的 `LlmRuntime` 在 `prepareCall` 与 `adapterStream` 两条路径**无条件调用** `registration.adapter.prepareCall(...)`（rc.6 只要求 stream/…）；插件两个对象字面量包装（stealth 接管路由 / 隐藏原生路由）未实现 → 选 vision 模型即报 `registration.adapter.prepareCall is not a function`。`imageRequestPricing` 同为新契约，一并补上。
  3. **视觉端点配置失效 + autoCaption 阻塞**：settings 文档（与 profile 补丁层冲突）曾为 `enabled:false`；第三方端点 yzcld 的 key 实测 401 `INVALID_API_KEY`；`autoCaption:true` 时每次贴图在发主模型前阻塞调用视觉端点（timeoutMs 60000）→ 端点不稳/失效时表现为"发图卡死、不调模型、很慢"。
- **决策**：
  1. `src/session-refs.js` 新增纯函数 `sessionEventsOf(agent)`：优先 `snapshotEvents()`、次 `ownEvents()`、兜底旧 `session.events` 数组，兼容 rc.6 与 0.1.2-rc.1 两代核心形状；`src/analyze-tool.js` 改用之。
  2. `src/adapter.js` 的 `createStealthAdapter` 与 `createHiddenNativeAdapter` 补齐 `prepareCall(provider, model, signal)`（语义同 rc1 `LlmAdapter` 基类默认实现：`resolveModel` 绑定 + 本 adapter `stream` 分发）与 `imageRequestPricing`（委托原生 adapter），补全 rc1 对象字面量 adapter 方法面。
  3. **配置对齐**：`~/.dsh/settings.yaml` 的 `dsh-vision-adapter.enabled` 由 false 改 true（与权威补丁层一致，改前已备份）；视觉端点由失效的 yzcld 切到**官方 DeepSeek 多模态** `https://api.deepseek.com` + `deepseek-v4-flash-vision-exp`（0.1.2-rc.1 官方 llm-deepseek 已原生支持 image 输入，settings 的 `llm-deepseek.models` 也已声明该模型 `input: [text, image]`；credentials `DEEPSEEK_API_KEY` 实测 HTTP 200 能正确识图）；`autoCaption:false` 消除贴图阻塞。`settings.yaml`（live 覆盖层）与 web profile `cordis.patch.yml`（权威层，需重启生效）两处同步修改，均留 `.bak-20260908-vision-fix` 备份。
- **验证**：
  - TDD：先写 rc1 Session 形状（snapshotEvents/ownEvents）与 prepareCall 存在性的失败测试（各红），再实现转绿；**58/58 测试通过**（原 53 + analyze-tool 2 + adapter 3），全部源文件 `node --check` 通过。
  - 运行时实测链路：附件完整 id 解析成功 → 会话日志读取修复生效（GUI 重启后）；官方端点 `POST https://api.deepseek.com/chat/completions`（model `deepseek-v4-flash-vision-exp` + 该截图 WebP）返回 HTTP 200 并正确描述画面。
  - 配置端点实测：`enabled=true autoCaption=false model=deepseek-v4-flash-vision-exp baseURL=https://api.deepseek.com`。
- **遗留/风险**：profile 补丁层（权威配置）在 GUI 启动时加载，用户需**重启 DSH Desktop** 使工具运行时读到官方端点与 autoCaption=false；0.1.2-rc.1 起官方 vision 模型可原生收图，`deepseek-v4-flash-vision-exp` 为最干净路径，dsh-vision-adapter 的 analyze_image 作为文本主模型按需"眼睛"保留；host peer 仍为 `^0.1.0-rc.6`（语义满足 0.1.2-rc.1），如需收紧可随下一版统一升级。
