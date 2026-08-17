# dsh-deepseek-cost

按 **DeepSeek 官方定价**统计当前对话的 token 用量与累计费用（人民币），在聊天输入框下方的统计行旁边实时显示。

- **Token 明细**：未缓存输入（cache miss）、缓存命中输入（cache hit）、缓存写入、输出 —— 直接取 DSH 会话日志中 provider 报告的 `usage`（与官方 stats 行同源，非估算）。
- **分时计价**：官方按「高峰 / 空闲」两个时段计费（空闲 = 高峰半价）。高峰时段为**北京时间 9:00–12:00 与 14:00–18:00**；插件按每次请求发生的时刻自动选择时段。
- **按模型计费**：不同模型（`deepseek-v4-flash` / `deepseek-v4-pro`）各自累计、各自计价，多模型混用的会话费用相加。
- **持久可靠**：费用随会话日志重放（`tokenCost` 会话投影），对话压缩、重启后依然准确；浏览器端通过 `useProjection('tokenCost')` 实时接收 Host 推送。

## 展示位置

聊天区域输入框下方（`conversation.composer.dock`，官方统计行右侧），例如：

```
费用 ¥0.0421 | Flash ¥0.0400 · Pro ¥0.0021
```

悬停可看每个模型的 token 明细与合计：

```
V4-Flash：未缓存输入 12.3K · 缓存输入 45.1K · 输出 2.1K = ¥0.0400
V4-Pro：未缓存输入 1.2K · 输出 0.9K = ¥0.0021
合计 ¥0.0421
最近一次计费：高峰时段（官方价，元/百万 tokens）
```

尚无计费活动时（用量为 0 或投影未就绪）不显示。

## 官方定价快照

定价取自 [DeepSeek 官方「模型 & 价格」页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)（2026-08-17 抓取，人民币 / 百万 tokens；仅人民币计价）：

| 计费项（每百万 tokens） | deepseek-v4-flash | deepseek-v4-pro |
|---|---|---|
| 输入 · 缓存命中 · 空闲 / 高峰 | ¥0.05 / ¥0.10 | ¥0.15 / ¥0.30 |
| 输入 · 缓存未命中 · 空闲 / 高峰 | ¥1.5 / ¥3.0 | ¥4.5 / ¥9.0 |
| 输出 · 空闲 / 高峰 | ¥4.5 / ¥9.0 | ¥13.5 / ¥27.0 |

> 官方未单列缓存写入价，缓存写入并入「未命中输入」计费。定价可能调整，可用下方配置覆盖。

## 安装

本地开发：

```sh
dsh plugin --profile <name> add ./bundles/dsh-deepseek-cost
```

从 GitHub 只取本插件：

```sh
dsh plugin --profile <name> add "Siq5005/dsh-plugins#path:/bundles/dsh-deepseek-cost"
```

## 配置

`cordis.patch.yml` 中该插件的 `config`（全部可选；**修改需重启生效**）：

```yaml
- insert:
    - id: dsh-deepseek-cost
      name: dsh-deepseek-cost
      config:
        enabled: true
        # defaultRates: # 未知模型的兜底价（缺省取 V4-Flash 档）
        #   peak:    { cacheMiss: 3.0, cacheHit: 0.10, output: 9.0 }
        #   offpeak: { cacheMiss: 1.5, cacheHit: 0.05, output: 4.5 }
        # models: # 按模型 id 覆盖官方定价；offpeak 缺省为 peak 的一半
        #   - id: deepseek-v4-pro
        #     name: DeepSeek-V4-Pro
        #     peak: { cacheMiss: 9.0, cacheHit: 0.30, output: 27.0 }
```

## 结构

```
dsh-deepseek-cost/
├── package.json        # 声明 dsh.bundle + dsh.client
├── cordis.patch.yml    # 组合包贡献的配置层
├── src/
│   ├── index.js        # Host 入口：Config + apply（注册 tokenCost 投影）
│   ├── pricing.js      # 官方定价表 + 高峰/空闲时段 + 费用计算（纯函数）
│   └── cost-projection.js # tokenCost 会话投影（按模型折叠 usage）
├── lib/client.js       # 浏览器端：composer.dock 费用行
└── test/               # node:test（定价 / 投影 / 冒烟）
```

## 验证

```sh
cd bundles/dsh-deepseek-cost
node --test --test-timeout=15000 test/*.test.js
```

## 已知限制

- 只展示本会话（当前对话）的费用；子 Agent 会话在各自会话中展示。
- 定价为快照，若官方调价请更新 `src/pricing.js` 或使用 `models` 配置覆盖。
