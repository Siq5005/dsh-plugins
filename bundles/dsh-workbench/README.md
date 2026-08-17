# dsh-workbench

DSH Web GUI 右侧工作台：**文件浏览/编辑/预览 + 内嵌浏览器 + Git 面板**，VS Code 式布局。

## 能力

- **布局**：占用 shell 右侧 details 布局列（`layout.openDetails/closeDetails` 控制），对话区自动收缩、**不遮挡聊天**；顶部 tab 栏（文件/浏览器/Git）+ 底部面板（可调高度/隐藏）。入口：会话头部「工作台」按钮。
- **文件**：目录树（懒加载、目录优先排序）→ 文本编辑（`Cmd/Ctrl+S` 保存、dirty 标记）、图片预览、Markdown 预览切换、`.md`/文本外任意文件按扩展名分流；根目录可切换（工作区快捷项 / 任意绝对路径）。
- **浏览器**：沙箱 iframe 内嵌浏览（后退/前进/刷新、地址栏过滤 `javascript:`/`data:`/`file:`），一键「系统浏览器」外开。
- **Git**：真实 `git` CLI——状态（porcelain v1，含重命名解析）、分支 + HEAD、文件 diff（工作区/暂存区切换）、暂存/撤销暂存/还原（还原两次确认）、提交、最近 30 条历史。

## 数据与安全

- 数据源：当前会话工作目录（`fs` 服务）+ 真实 `git`，经 host 侧 `/dsh-workbench/*` HTTP 路由提供（JSON），**loopback 围栏**（非本机访问 403）。
- 路径一律经 `fs.resolve` + `fs.contains` 越界校验；文本读取 ≤2MB、图片 ≤8MB。
- 浏览器 iframe 为不透明源沙箱（无 `allow-same-origin`），需登录或拒绝嵌入的站点无法显示。

## 安装

```sh
# 本地开发
dsh plugin --profile <name> add ./bundles/dsh-workbench

# 从 GitHub 直接安装
dsh plugin --profile <name> add "Siq5005/dsh-plugins#path:/bundles/dsh-workbench"
```

安装后重启 `dsh web`，打开项目会话 → 会话头部右侧「工作台」按钮。

## 说明与致谢

- 本插件是借鉴学习的产物：**架构/布局思路**参考 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)（MIT）与 [dsh-web-ui / dsh-aionui-panel](https://github.com/zhu1090093659/dsh-web-ui)（BSD-3-Clause，AionUi 复刻）；代码为自写实现（结构参考上游，未大段抄录）。
- 已知限制：右侧列会**替换内置的「工具调用详情」面板**（VS Code 式右面板的取舍）；无文件 watcher（需手动刷新）；Git 无 push/pull/fetch。

## License

MIT，见 [LICENSE](LICENSE)。
