# skills/ — 技能

技能是目录形式的可加载技能包，为 AI 助手提供可复用的专业知识与操作流程。

## 结构

```
skills/<skill-name>/
├── SKILL.md        # 技能说明与指令（必需）
└── ...             # 附属资源
```

## 索引

新增技能后必须同步更新根目录 [`plugins.json`](../plugins.json) 与 [README 目录表](../README.md)。
