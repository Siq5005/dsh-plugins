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



