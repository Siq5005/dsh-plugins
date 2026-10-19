# Core Patches Archive

本目录归档 `@deepseek-ai/*` 核心包的手工修复（pnpm patch 补丁），供本集合仓库可检索、可复现。

| 补丁 | 目标核心 | 语义 | 权威位置（应用处） |
| --- | --- | --- | --- |
| `@deepseek-ai__dsh-sandbox@0.1.2-rc.1.patch` | `dsh-sandbox@0.1.2-rc.1`（内容对 `0.1.5-rc.2` 同样适用，见下） | `approveEscalation` same-mode 请求幂等返回 `effectiveMode`（不报错、不进审批、不放大权限阶梯） | `Siq5005/dsh-desktop`：`patches/@deepseek-ai__dsh-sandbox@0.1.5-rc.2.patch` + `pnpm-workspace.yaml` 的 `patchedDependencies`（D-016；版本跟随见 D-025） |

**版本跟随说明（2026-09-14，D-025）**：核心基准升到 `0.1.5-rc.2` 时，实测两版 `dsh-sandbox/lib/index.js` **字节完全相同**（sha256 `8994b3e4…`、git blob `9fb79a71…`），上游仍未合入该修复，故补丁内容零改动，仅文件名与 `patchedDependencies` 的键跟随版本号更新。本目录的归档副本保留原文件名以固定 D-016 的历史记录。

**上游仍然缺失**：`0.1.5-rc.2` 的 `approveEscalation` 依旧直接抛 `not strictly wider`（`grep -c 'mode === effectiveMode'` = 0），即修复未被上游采纳；升级核心后必须继续带该补丁。

诊断原始记录（问题现象、根因链、最小改动面）：`Siq5005/dsh-desktop` 的 `docs/dsh-codex-terra-bash-diagnosis.md`。

使用：把补丁拷回宿主仓库（如 `dsh-desktop`）的对应位置并记录 `patchedDependencies` 后 `pnpm install` 自动重放；不要在 `node_modules` 里手改。
## 非 pnpm patch 类：可重放改写脚本

下列制品**不是** `pnpm patch`（它们改写的是第三方插件自身的源码文件，不是 `@deepseek-ai/*` 核心包），靠脚本幂等重放。

| 脚本 | 目标文件 | 语义 | 应用处 | 重放 / 回滚 |
| --- | --- | --- | --- | --- |
| `remielle-ledger-basis.mjs` | `dsh-pet-remielle/src/balance.js` | 桌宠「今日已用」改为读 `~/.dsh/storages/cost-meter/ledger.json` 的 `days[today].costCny`（花费单一口径，见 D-030）；读不到账本时回落上游「余额差值累计」逻辑 | 本机 `~/.dsh/profiles/desktop/node_modules/dsh-pet-remielle/src/balance.js` | 应用：`node remielle-ledger-basis.mjs`（幂等，标记 `[unified-basis]`）；检查：`--check`；回滚：`cp src/balance.js.bak-prebasis src/balance.js`。**`dsh-pet-remielle` 每次升级后必须重跑**，否则静默回到旧口径 |

脚本自身 sha256：`8696499f0cdf0dfca235ce12113b6e659611f8da`。