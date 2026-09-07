# Core Patches Archive

本目录归档 `@deepseek-ai/*` 核心包的手工修复（pnpm patch 补丁），供本集合仓库可检索、可复现。

| 补丁 | 目标核心 | 语义 | 权威位置（应用处） |
| --- | --- | --- | --- |
| `@deepseek-ai__dsh-sandbox@0.1.2-rc.1.patch` | `dsh-sandbox@0.1.2-rc.1` | `approveEscalation` same-mode 请求幂等返回 `effectiveMode`（不报错、不进审批、不放大权限阶梯） | `Siq5005/dsh-desktop`：`patches/` + `pnpm-workspace.yaml` 的 `patchedDependencies`（D-016） |

使用：把补丁拷回宿主仓库（如 `dsh-desktop`）的对应位置并记录 `patchedDependencies` 后 `pnpm install` 自动重放；不要在 `node_modules` 里手改。