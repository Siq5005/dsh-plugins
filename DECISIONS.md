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
