# dsh-plugins

我的 DeepSeek Harness (DSH) 插件集合仓库 —— 归档 AI 自用插件，同时支持他人在集合中**搜寻**并**只取需要的插件**。

决策记录见 [DECISIONS.md](DECISIONS.md)。

## 插件目录（索引）

| 插件 | 类型 | 说明 | 路径 |
|---|---|---|---|
| dsh-hello-plugin | bundle | 示例插件：验证安装链路的最小模板 | [bundles/hello-plugin](bundles/hello-plugin/) |

完整机器可读索引见 [`plugins.json`](plugins.json)（字段定义见 [`plugins.schema.json`](plugins.schema.json)）。

## 只取一个插件（三种方式）

### 1. 零 clone 直接安装（推荐）

`dsh plugin add` 转发给 pnpm，pnpm 支持从 git 仓库安装子目录，只拉取目标插件：

```sh
dsh plugin --profile <name> add "Siq5005/dsh-plugins#path:/bundles/hello-plugin"
```

### 2. 稀疏克隆（拿插件源码）

```sh
git clone --filter=blob:none --no-checkout https://github.com/Siq5005/dsh-plugins.git
cd dsh-plugins
git sparse-checkout set bundles/hello-plugin
```

只下载目标插件的文件内容（`--filter=blob:none` 为 partial clone，元数据极轻）。

### 3. 免 git 下载

- 打开 [download-directory.github.io](https://download-directory.github.io/)，粘贴目录链接 `https://github.com/Siq5005/dsh-plugins/tree/main/bundles/hello-plugin`，下载该目录的 zip；
- 或命令行：`gh api repos/Siq5005/dsh-plugins/contents/bundles/hello-plugin` 逐个取文件。

## 目录规划

```
dsh-plugins/
├── bundles/     # 可安装组合包（声明 dsh.bundle 的 npm 包）
├── skills/      # 技能：目录形式的可加载技能包
├── tools/       # 独立工具脚本 / MCP 服务
├── plugins.json # 机器可读插件索引（搜寻用）
└── DECISIONS.md # 决策记录
```

## 新增插件流程

1. 在对应目录创建插件（参考 [`bundles/hello-plugin`](bundles/hello-plugin/) 模板）；
2. 本地验证：`dsh plugin --profile dev add ./bundles/<name>`；
3. 更新 [`plugins.json`](plugins.json) 与上方目录表；
4. `git commit` + `git push` 归档。

## 插件是什么

在 DSH 中，插件是一个导出 `apply(ctx)` 函数的 TypeScript/JavaScript 模块。框架加载时调用 `apply`，传入上下文对象 `ctx`，通过 `ctx` 注册能力（事件监听、工具、定时器等），插件卸载时自动清理。

一个可安装的**组合包（bundle）**结构如下：

```
hello-plugin/
├── package.json       # 声明 dsh.bundle
├── cordis.patch.yml   # 组合包贡献的配置层
└── index.js           # 插件模块
```

`package.json` 中的 manifest：

```json
{
  "name": "dsh-hello-plugin",
  "version": "0.1.0",
  "type": "module",
  "main": "index.js",
  "files": ["index.js", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

## 安装方式

从本仓库目录安装某个插件包到指定 profile：

```sh
dsh plugin --profile <name> add ./bundles/<plugin-name>
```

验证配置层：

```sh
dsh --profile <name> --dump-config
```

## 参考文档

- [第一个插件](https://deepseek-harness.dev/)（docs/user/develop/basic/index.zh.md）
- [打包与安装插件](https://deepseek-harness.dev/)（docs/user/develop/basic/publish.zh.md）
- [pnpm: 从 git 仓库安装子目录](https://pnpm.io/package-sources)（`#path:` 参数）

## License

私有使用；如包含第三方代码，请遵守对应上游许可。
