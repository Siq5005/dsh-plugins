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
