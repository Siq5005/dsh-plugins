# dsh-plugins

我的 DeepSeek Harness (DSH) 个人插件集合仓库。

这里收集和存放我为自己编写的 DSH 插件、技能（skills）与工具，按需通过 `dsh plugin` 安装使用。

## 目录规划

```
dsh-plugins/
├── bundles/     # 可安装的组合包（声明 dsh.bundle 的 npm 包）
├── skills/      # 技能：目录形式的可加载技能包
└── tools/       # 独立工具脚本 / MCP 服务
```

> 当前仓库刚建立，目录会随插件逐个加入而填充。

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

## License

私有使用；如包含第三方代码，请遵守对应上游许可。
