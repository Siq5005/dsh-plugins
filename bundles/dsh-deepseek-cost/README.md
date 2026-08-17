# dsh-deepseek-cost

按 **DeepSeek 官方定价**统计当前对话的 token 用量与累计费用（人民币），在聊天输入框下方的统计行旁边实时显示。

- **Token 明细**：未缓存输入（cache miss）、缓存命中输入（cache hit）、缓存写入、输出 —— 直接取 DSH 会话日志中 provider 报告的 `usage`（与官方 stats 行同源，非估算）。
- **分时计价**：官方按「高峰 / 空闲」两个时段计费（空闲 = 高峰半价）。高峰时段为**北京时间 9:00–12:00 与 14:00–18:00**；插件按每次请求发生的时刻自动区分。
- **按模型计价**：**DeepSeek 官方模型**（`deepseek-v4-flash` / `deepseek-v4-pro`）自动使用官方默认定价（只读）；**其他模型**在「设置 → 费用统计」中填写价格（每百万 tokens 元，flat 三桶价），保存后**即时生效**（无需重启）。多模型混用的会话费用相加。
- **持久可靠**：token 用量随会话日志重放（`tokenCost` 会话投影），对话压缩、重启后依然准确；浏览器端通过 `useProjection('tokenCost')` 实时接收 Host 推送。

## 展示位置

聊天区域输入框下方（`conversation.composer.dock`，官方统计行右侧），例如：

```
费用 ¥0.0421 | Flash ¥0.0400 · Pro ¥0.0021
```

悬停可看每个模型的 token 明细与合计：

```
V4-Flash：高峰未缓存输入 12.3K · 高峰缓存输入 45.1K · 空闲输出 2.1K = ¥0.0400
V4-Pro：空闲未缓存输入 1.2K · 空闲输出 0.9K = ¥0.0021
合计 ¥0.0421
最近一次计费：高峰时段
```

有 token 但未配置价格的模型会提示「N 个模型未配置价格」，并在 hover 里列出模型 id，引导去设置页填写。尚无计费活动时（用量为 0 或投影未就绪）不显示。

## 费用统计设置页

侧栏设置 → **费用统计**（`settings.section`）：

- **DeepSeek 官方默认定价**：只读表格展示 `deepseek-v4-flash` / `deepseek-v4-pro` 的高峰 / 空闲三桶价。
- **其他模型价格**：为每个非官方模型填写 `模型 id`、可选展示名，以及每百万 tokens 的 `未命中 / 命中 / 输出` 三桶价（flat，不区分高峰空闲），可增删；点「保存」后即时生效。
- **启用费用统计**：总开关。

## 官方定价快照

定价取自 [DeepSeek 官方「模型 & 价格」页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)（2026-08-17 抓取，人民币 / 百万 tokens；仅人民币计价）：

| 计费项（每百万 tokens） | deepseek-v4-flash | deepseek-v4-pro |
|---|---|---|
| 输入 · 缓存命中 · 空闲 / 高峰 | ¥0.05 / ¥0.10 | ¥0.15 / ¥0.30 |
| 输入 · 缓存未命中 · 空闲 / 高峰 | ¥1.5 / ¥3.0 | ¥4.5 / ¥9.0 |
| 输出 · 空闲 / 高峰 | ¥4.5 / ¥9.0 | ¥13.5 / ¥27.0 |

> 官方未单列缓存写入价，缓存写入并入「未命中输入」计费。官方调价需更新 `src/pricing.js`（改代码后重启生效）。

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

`cordis.patch.yml` 中该插件的 `config`（全部可选；**yml 修改需重启生效**，设置页内修改即时生效）：

```yaml
- insert:
    - id: dsh-deepseek-cost
      name: dsh-deepseek-cost
      config:
        enabled: true
        # models: # 预置的自定义模型价格（也可在设置页添加）
        #   - id: gpt-4o
        #     name: GPT-4o
        #     cacheMiss: 5.0
        #     cacheHit: 0.5
        #     output: 10.0
```

## 结构

```
dsh-deepseek-cost/
├── package.json        # 声明 dsh.bundle + dsh.client
├── cordis.patch.yml    # 组合包贡献的配置层
├── src/
│   ├── index.js        # Host 入口：Config + settings 命名空间 + 配置端点 + 注册投影
│   ├── pricing.js      # 官方定价表 + 高峰/空闲时段 + 费用计算（纯函数）
│   └── cost-projection.js # tokenCost 会话投影（按模型 × 时段折叠 usage，纯 token 事实）
├── lib/client.js       # 浏览器端：composer.dock 费用行 + 费用统计设置页
└── test/               # node:test（定价 / 投影 / 配置端点 / 冒烟）
```

## 验证

```sh
cd bundles/dsh-deepseek-cost
node --test --test-timeout=15000 test/*.test.js
```

## 已知限制

- 只展示本会话（当前对话）的费用；子 Agent 会话在各自会话中展示。
- 官方模型定价为代码快照，官方调价需更新 `src/pricing.js`；自定义模型价格可在设置页随时修改。
- 自定义模型按 flat 价计费（不区分高峰/空闲时段），与 DeepSeek 官方分时计价不同。
