# 新对话启动指南（SESSION START）

> 本仓库的插件由 AI 助手开发。**新开一个对话**继续开发时，新对话的 agent
> 没有本对话的历史——先读本文件与下列关键文件，即可快速恢复全部上下文。
>
> 本文件本身也是为 AI 写的：请完整读完再开始工作。
>
> **隐私约定（重要）**：本仓库在 GitHub 上是**公开**的。文中所有路径一律用
> `$HOME` 相对形式或仓库内相对路径，**禁止**写入本机绝对路径（如
> `/Users/<用户名>/...`）、个人用户名或真实邮箱。

## 一、直接粘贴的启动提示

新开对话后，把下面整段作为第一条消息发出（`<新插件需求>` 换成实际需求）：

---

请先读取本仓库（当前工作目录，用 `pwd` 确认）并恢复上下文：

1. 依次读：`SESSION_START.md`（本文件）、`DECISIONS.md`、`README.md`、
   `plugins.json`、`plugins.schema.json`、`bundles/README.md`
2. 读完先简述你的理解（仓库定位、插件约定、新增流程），再开始开发
3. 本次要开发的插件需求：<新插件需求>

---

## 二、仓库是什么

- **仓库**：`Siq5005/dsh-plugins`（公开）—— DeepSeek Harness (DSH) 插件集合仓库
- **定位**：AI 自用 + 支持他人在集合中**搜寻**并**只取单个插件**（方案 A，见 D-003）
- **决策记录**：`DECISIONS.md`
  - D-001：仓库定位与内容组织（bundles/ skills/ tools/）
  - D-002：直接在集合仓库内开发（每插件一个自包含子目录）
  - D-003：分发工作流——README 目录表 + `plugins.json` 索引 + 三种"只取一个插件"方式
  - D-004：首个实际插件 dsh-dafeiyu-mac（复刻桌宠）的决策与遗留
  - D-005：第二个实际插件 dsh-deepseek-cost（对话费用统计）

## 三、关键文件

| 文件 | 作用 |
|---|---|
| `DECISIONS.md` | 所有架构/流程决策（新决策追加为 D-00x） |
| `README.md` | 插件目录表 + 单插件获取方式 + 新增流程 |
| `plugins.json` / `plugins.schema.json` | 机器可读索引与格式定义 |
| `bundles/README.md` | bundle 结构规范 |
| `bundles/hello-plugin/` | 最小可安装模板插件 |
| `bundles/dsh-dafeiyu-mac/` | 第一个实际插件：macOS 桌宠（三层架构参考样板） |

## 四、新增插件标准流程（D-003 约定）

1. 在 `bundles/<plugin-name>/` 创建插件（参考 `hello-plugin` 模板：
   `package.json` 声明 `dsh.bundle` + `cordis.patch.yml` + 入口模块）
2. 本地验证（见第六节）
3. 更新 `plugins.json` 索引 + `README.md` 目录表
4. `git commit` + `git push` 归档

## 五、本机开发环境（macOS）

- **工作区**：本仓库（`pwd` 定位；git，origin 已指向 GitHub）
- **DSH 源码**：`$HOME/project/deepseek/deepseek-harness`（如位置不符，
  以当前环境为准）；源码跑 CLI 用 `pnpm dsh`（需在该目录执行，
  PATH 需含 `/opt/homebrew/bin`）
- **本机 profile**：`web`（`~/.dsh/profiles/web`）
  - profile 的 bundle 列表在 `package.json` 的 `dsh.profile.bundles`
  - 用户层覆盖在 `cordis.patch.yml`（当前为 dsh-dafeiyu-mac 配置
    `helper.command: ~/.dsh-dafeiyu-venv/bin/python`）
- **桌宠 Python 环境**：venv `~/.dsh-dafeiyu-venv`
  （装有 PySide6 + pyobjc-framework-Cocoa）
- **GitHub CLI**：`/opt/homebrew/bin/gh`（登录账号 Siq5005）

## 六、验证命令速查

```sh
# bundle 目录内的 JS 测试（dsh-dafeiyu-mac 有 14 个）
cd bundles/<name>
node --test --test-timeout=15000 test/*.test.js

# Python helper 协议模式（无需 Qt）
python3 runtime/helper.py --headless

# 配置组合验证（在 DSH 源码目录）
cd "$HOME/project/deepseek/deepseek-harness"
pnpm dsh --profile web --dump-config

# 安装/卸载 bundle 到 profile
pnpm dsh plugin --profile web add    <本地或 git 路径>
pnpm dsh plugin --profile web remove <包名>
```

## 七、本机已知陷阱（踩过的坑）

- **pnpm**：`npm install` 会撞 `~/.npm` 权限问题，统一用 `pnpm`。
- **patch 语法**：loader patch 条目是**扁平结构**（`- id: <name>` 直接作条目），
  不是 `update:` 包裹；`config` 为**整体替换**（覆盖需列出全部字段）。
- **QLabel 渲染**：`setPixmap` 后必须 `adjustSize()`，否则角色被裁在默认
  100×30 的小框里。
- **macOS 窗口标志**：`Qt.WindowDoesNotAcceptFocus` 会收不到鼠标事件导致
  无法拖动——桌宠窗口用 `FramelessWindowHint | WindowStaysOnTopHint`。
- **PySide6 6.x**：`QAction` 在 `QtGui`（不在 `QtWidgets`）。
- **macOS python3**：不支持 Windows `py` 的 `-3` 参数。
- **隐藏 Dock 图标 / 全桌面显示**：需要 pyobjc（venv 已装），
  见 `dsh-dafeiyu-mac/runtime/helper.py` 的 `hide_dock_icon` /
  `_enable_all_spaces`。

## 八、常用参考

- 单插件获取（他人视角）：零 clone 安装 `dsh plugin add "Siq5005/dsh-plugins#path:/bundles/<name>"`、
  稀疏克隆 `git clone --filter=blob:none --sparse` + `git sparse-checkout set ...`、
  download-directory.github.io
- DSH 插件教程（源码内）：`$HOME/project/deepseek/deepseek-harness/docs/user/develop/basic/`
  （index = 第一个插件，publish = 打包与安装）
