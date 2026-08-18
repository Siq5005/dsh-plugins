# dsh-desktop-context-menu

给 DSH Desktop 的 Electron 窗口加原生右键菜单。当前菜单项：

- 可编辑区域：剪切 / 复制 / 粘贴 / 全选
- 非编辑区域：复制（有选中文本时）/ 全选
- 有导航历史时：后退 / 前进

## 定位

Host-only bundle，仅在 DSH Desktop 的 Electron 主进程生效；普通 Web profile
加载时自动 no-op，不会在浏览器侧引入 Node API。

实现方式：监听 Electron `app` 的 `browser-window-created`，对每个
`BrowserWindow` 的 `webContents` 挂 `context-menu`，用
`Menu.buildFromTemplate` 弹原生菜单。重复加载时通过 `WeakSet` 去重，
避免同一 `webContents` 挂多个监听。

## 安装

```sh
dsh plugin --profile <name> add "Siq5005/dsh-plugins#path:/bundles/dsh-desktop-context-menu"
```

安装到 DSH Desktop 使用的 profile 后，用 `dsh-desktop` 启动桌面端即可生效。
