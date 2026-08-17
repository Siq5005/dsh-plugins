# bundles/ — 可安装组合包

每个子目录是一个可独立安装的 DSH 组合包（bundle）。

## 包结构

```
bundles/<plugin-name>/
├── package.json       # 声明 dsh.bundle
├── cordis.patch.yml   # 组合包贡献的配置层
└── index.js           # 插件模块（export apply(ctx)）
```

参考模板：[hello-plugin](./hello-plugin)

## 安装

本地（开发测试）：

```sh
dsh plugin --profile <name> add ./bundles/<plugin-name>
```

从 GitHub 直接安装（无需 clone 本仓库，只取该插件）：

```sh
dsh plugin --profile <name> add "Siq5005/dsh-plugins#path:/bundles/<plugin-name>"
```

## 索引

新增包后必须同步更新根目录 [`plugins.json`](../plugins.json) 与 [README 目录表](../README.md)。
