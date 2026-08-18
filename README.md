# dsh-plugins

DeepSeek Harness（DSH）插件集合。这里收录了一批可直接安装、可独立使用的 DSH 插件，你可以按需挑选，只安装自己需要的那个。

- **即装即用**：无需克隆整个仓库即可安装单个插件。
- **独立自洽**：每个插件都是自包含目录，附有各自的 README、配置与许可说明。
- **便于检索**：提供机器可读索引 [`plugins.json`](plugins.json)，方便脚本、自动化与 AI 工具查找。

## 快速开始

### 环境要求

- Node.js 20+
- 已安装 DeepSeek Harness 的 `dsh` 命令行工具

### 安装单个插件

以 `dsh-workbench` 为例（`<name>` 替换为你的 profile 名称）：

```sh
dsh plugin --profile <name> add "Siq5005/dsh-plugins#path:/bundles/dsh-workbench"
```

也可以克隆仓库后从本地安装：

```sh
git clone https://github.com/Siq5005/dsh-plugins.git
cd dsh-plugins
dsh plugin --profile <name> add ./bundles/dsh-workbench
```

> 下文插件目录中的安装命令省略了 `--profile`；如需指定 profile，请补上 `--profile <name>`。

## 插件目录

### 本仓库插件

| 插件 | 说明 | 安装 |
| --- | --- | --- |
| [dsh-hello-plugin](bundles/hello-plugin/) | 最小示例模板，用于验证 DSH 插件安装链路 | `dsh plugin add "Siq5005/dsh-plugins#path:/bundles/hello-plugin"` |
| [dsh-dafeiyu-mac](bundles/dsh-dafeiyu-mac/) | macOS 桌面大肥鱼：由 DSH 会话状态驱动的桌宠伴侣 | `dsh plugin add "Siq5005/dsh-plugins#path:/bundles/dsh-dafeiyu-mac"` |
| [dsh-deepseek-cost](bundles/dsh-deepseek-cost/) | 按 DeepSeek 官方定价统计当前对话的 token 用量与累计费用 | `dsh plugin add "Siq5005/dsh-plugins#path:/bundles/dsh-deepseek-cost"` |
| [dsh-vision-adapter](bundles/dsh-vision-adapter/) | 给 DeepSeek 主模型加“眼睛”，让纯文本模型可以按需调用多模态端点看图 | `dsh plugin add "Siq5005/dsh-plugins#path:/bundles/dsh-vision-adapter"` |
| [dsh-workbench](bundles/dsh-workbench/) | 右侧工作台：文件浏览/编辑/预览 + 内嵌浏览器 + Git 面板 | `dsh plugin add "Siq5005/dsh-plugins#path:/bundles/dsh-workbench"` |
| [dsh-desktop-context-menu](bundles/dsh-desktop-context-menu/) | 给 DSH Desktop 窗口加原生右键菜单（Host-only） | `dsh plugin add "Siq5005/dsh-plugins#path:/bundles/dsh-desktop-context-menu"` |

### 独立仓库插件

| 插件 | 说明 | 安装 |
| --- | --- | --- |
| [dsh-desktop](https://github.com/Siq5005/dsh-desktop) | 桌面客户端：Electron 壳 + DSH Host，托盘 / 多 profile / DMG 打包 | 见 [dsh-desktop 仓库](https://github.com/Siq5005/dsh-desktop) |

### 外部 npm 插件

| 插件 | 说明 | 安装 |
| --- | --- | --- |
| `@linxin666/dsh-liangshen` | 梁神模式：两阶段锚定 agent 预设 | `dsh plugin add @linxin666/dsh-liangshen` |
| `@linxin666/dsh-skins` | 皮肤中心 + 多款内置皮肤 | `dsh plugin add @linxin666/dsh-skins` |
| `@linxin666/dsh-ssh` | 远程 SSH 运维：主机管理 / Web 终端 / SFTP / 隧道 / 集群 | `dsh plugin add @linxin666/dsh-ssh` |

> 外部 npm 插件由上游仓库发布，安装与升级请以对应项目说明为准。
>
> `dsh-skins` 的皮肤中心通常还需安装 `@linxin666/dsh-client-ui-web-ui-settings`。

## 只安装一个插件

本仓库支持多种按需取用方式，无需下载全部插件。

### 1. 直接安装（推荐）

`dsh plugin add` 会转发给 pnpm，可从 git 仓库安装子目录：

```sh
dsh plugin add "Siq5005/dsh-plugins#path:/bundles/<plugin-name>"
```

### 2. 稀疏克隆

只检出目标插件目录：

```sh
git clone --filter=blob:none --sparse https://github.com/Siq5005/dsh-plugins.git
cd dsh-plugins
git sparse-checkout set bundles/<plugin-name>
```

### 3. 免 git 下载

使用 [download-directory.github.io](https://download-directory.github.io/) 下载单个目录的 zip，或用 GitHub API 拉取目标目录下的文件。

## 仓库结构

```
dsh-plugins/
├── bundles/              # 可安装组合包（bundle）
├── skills/               # 技能包
├── tools/                # 独立工具脚本 / MCP 服务
├── plugins.json          # 机器可读插件索引
└── plugins.schema.json   # 索引字段定义
```

- [`bundles/`](bundles/)：可直接通过 `dsh plugin add` 安装的插件包。
- [`skills/`](skills/)：目录形式的可加载技能包。
- [`tools/`](tools/)：独立工具脚本或 MCP 服务。
- [`plugins.json`](plugins.json)：机器可读索引；字段定义见 [`plugins.schema.json`](plugins.schema.json)。

## 贡献

1. 在对应目录下创建插件，可参考 [`bundles/hello-plugin`](bundles/hello-plugin/)；
2. 本地验证安装与功能；
3. 更新 [`plugins.json`](plugins.json) 与上方的插件目录；
4. 提交 Pull Request。

提交前请确认：

- 插件目录自包含，并附有 README；
- 索引字段与 [`plugins.schema.json`](plugins.schema.json) 一致；
- 引用了第三方代码或素材时，保留相应许可说明。

## 许可

本仓库整体采用 [MIT License](LICENSE)。各插件目录内另有说明的，以目录内说明为准。

- 插件代码：MIT（目录内另有声明的除外）。
- `dsh-dafeiyu-mac` 的视觉素材：采用 [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) 许可，详见 [`ASSET_LICENSE.md`](bundles/dsh-dafeiyu-mac/ASSET_LICENSE.md)。

索引中列出的外部 npm 插件由各自项目负责许可与维护。
