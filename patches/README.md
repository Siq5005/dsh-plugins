# Core Patches Archive

本目录归档 `@deepseek-ai/*` 核心包的手工修复（pnpm patch 补丁），供本集合仓库可检索、可复现。

| 补丁 | 目标核心 | 语义 | 权威位置（应用处） |
| --- | --- | --- | --- |
| `@deepseek-ai__dsh-sandbox@0.1.2-rc.1.patch` | `dsh-sandbox@0.1.2-rc.1`（内容对 `0.1.5-rc.2` 同样适用，见下） | `approveEscalation` same-mode 请求幂等返回 `effectiveMode`（不报错、不进审批、不放大权限阶梯） | `Siq5005/dsh-desktop`：`patches/@deepseek-ai__dsh-sandbox@0.1.5-rc.2.patch` + `pnpm-workspace.yaml` 的 `patchedDependencies`（D-016；版本跟随见 D-025） |

**版本跟随说明（2026-09-14，D-025）**：核心基准升到 `0.1.5-rc.2` 时，实测两版 `dsh-sandbox/lib/index.js` **字节完全相同**（sha256 `8994b3e4…`、git blob `9fb79a71…`），上游仍未合入该修复，故补丁内容零改动，仅文件名与 `patchedDependencies` 的键跟随版本号更新。本目录的归档副本保留原文件名以固定 D-016 的历史记录。

**上游仍然缺失**：`0.1.5-rc.2` 的 `approveEscalation` 依旧直接抛 `not strictly wider`（`grep -c 'mode === effectiveMode'` = 0），即修复未被上游采纳；升级核心后必须继续带该补丁。

诊断原始记录（问题现象、根因链、最小改动面）：`Siq5005/dsh-desktop` 的 `docs/dsh-codex-terra-bash-diagnosis.md`。

使用：把补丁拷回宿主仓库（如 `dsh-desktop`）的对应位置并记录 `patchedDependencies` 后 `pnpm install` 自动重放；不要在 `node_modules` 里手改。