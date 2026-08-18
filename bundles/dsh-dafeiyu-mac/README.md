# dsh-dafeiyu-mac 🐋

**macOS 桌面大肥鱼**：由 DeepSeek Harness 真实会话状态驱动的桌宠伴侣。

学习复刻自 [QCYTSN/dsh-dafeiyu](https://github.com/QCYTSN/dsh-dafeiyu)（MIT），
保持三层架构与事件契约，按核心链路优先实现，并移植到 macOS（PySide6 渲染）。

## 它能做什么

- 离开 DSH 页面也能看到状态：透明、无边框、始终置顶的小窗口显示在桌面。
- 状态来自真实 Agent 事件：思考、查找、修改、执行、等待确认、完成、出错都有对应动作与文案。
- 显示项目名、当前阶段、正在进行的步骤与真实待办进度。
- 多会话时优先展示最需要注意的任务：`等待确认 > 错误 > 工作 > 思考 > 空闲`。
- 可拖拽移动；右键可退出。
- 可选联动 [dsh-deepseek-cost](../dsh-deepseek-cost/)：把当前 DeepSeek API Key 账号余额合并到状态气泡最下面一行（仅显示金额，不暴露密钥；默认关闭，在费用统计设置页开启）。

## 架构

```
┌─ DSH Host（JS 插件层）─────────────────────────────┐
│ src/index.js        Schema 配置 / settings / 配置端点 /   │
│                     监听 session/event（全局）           │
│ src/companion-reducer.js  会话事件 → 状态机              │
│ src/helper-process.js     spawn helper / 心跳 / 快照 /    │
│                          自动重启 / SHUTDOWN 优雅退出     │
│ src/protocol.js     JSONL 协议（protocolVersion=1）     │
│ lib/client.js       WebUI 设置卡片（slots 注入）          │
└──────────────────────────────────────────────────────┘
        ↓ 新行分隔 JSON（stdin/stdout）
┌─ 桌面渲染层（Python + PySide6）────────────────────────┐
│ runtime/helper.py         透明置顶窗口 / 状态气泡（含余额行）/ │
│                           拖拽 / 帧动画 + 程序化 motion       │
│ runtime/animation_model.py 状态 → 动画 clip 纯状态机       │
└──────────────────────────────────────────────────────┘
```

## 系统要求

- **macOS arm64**：开箱即用——已内置打包好的 helper 单文件（`runtime/bin/darwin-arm64/`，
  无需自备 Python / PySide6）。
- **其他平台 / 源码开发模式**：需要 Python 3.11+ 且 `pip install -r requirements.txt`
  （PySide6）；或运行 `bash scripts/build-helper.sh` 为当前平台构建 helper 单文件。
- 可用的 DeepSeek Harness WebUI

## 安装

```sh
# 本地（开发）
dsh plugin --profile <name> add ./bundles/dsh-dafeiyu-mac

# 从 GitHub 直接安装（只取本插件）
dsh plugin --profile <name> add "Siq5005/dsh-plugins#path:/bundles/dsh-dafeiyu-mac"
```

安装后到 WebUI：`设置 → 插件 → 插件配置 → 大肥鱼桌面伴侣（macOS 复刻版）`。

## 验证状态

- Node 测试 18/18 通过：协议（4，含 BALANCE）、余额联动格式化（3）、状态机 reducer（7）、
  helper 生命周期（2）、插件冒烟测试（1，模拟 DSH ctx 完整链路）、headless 集成（1，见下）
- headless 协议链路：JS ↔ Python JSONL 握手 / ping-pong / shutdown 干净退出
- 可视化冒烟：PySide6 窗口依次展示 IDLE/THINKING/WORKING/WAITING/SUCCESS/ERROR 后干净退出

```sh
node --test test/*.test.js        # JS 侧全部测试
python3 runtime/helper.py --headless   # 协议模式（无需 Qt）
python3 runtime/helper.py              # 可视化模式（需 PySide6）
```

## 素材与版权

- `assets/pet/` 动画帧来自 [QCYTSN/dsh-dafeiyu](https://github.com/QCYTSN/dsh-dafeiyu)，
  该部分**不在 MIT 许可内**，权利归各自所有者；详见 [ASSET_LICENSE.md](ASSET_LICENSE.md)。
- 代码（`src/`、`runtime/`、`lib/`）为复刻实现，结构参考上游（MIT），
  上游许可文本见 [LICENSE-UPSTREAM.md](LICENSE-UPSTREAM.md)。

## 动画系统（2026-08-18 扩展）

- **场景序列**（photoWall）：搜索时翻书查找全过程、工作时坐姿入场并保持坐姿、提问时出现 question 表情；入场动画（开门走进来）。
- **空闲巡逻**：待机一段时间后随机向左/右走一小段再停下（不改变记住的位置）。
- **互动**：双击戳一戳；右键菜单"摸摸头 / 戳一戳"；拖拽时抓取/放下姿势。
- 素材：`searching/`、`working/`、`enter/`、`question/`、`answer/`、拖拽细节帧来自上游 PR #23（CC BY-SA 4.0，见 ASSET_LICENSE.md）。

## 已知限制

- 内置打包 helper 为 **darwin-arm64** 单文件（PyInstaller onefile，约 39MB）；
  其他平台需自行 `bash scripts/build-helper.sh` 构建（详见系统要求）。
- onefile 首启需解压运行时（约 5~8 秒），属 PyInstaller 单文件的固有代价。
- 需要 pyobjc 才能在所有桌面（Spaces）显示与隐藏 Dock 图标——已包含在打包产物内。
