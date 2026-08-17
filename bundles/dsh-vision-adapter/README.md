# dsh-vision-adapter

给 DeepSeek 主模型加"眼睛"：图片在 **adapter 层**改写为文本，`analyze_image` 工具按需调用你配置的 OpenAI 兼容多模态端点，文字答案回到主模型继续推理。

- 主模型（DeepSeek 官方路由，纯文本）全程保持"大脑"；多模态模型只当"眼睛"，按需调用。
- 图片改写只发生在**发给模型的请求里**，session log 保持原样——Web UI 照常显示图片，历史准确。
- 问答结果按**图片内容哈希 + 问题**缓存，同一张图同一问题不重复花钱。
- 失败语义明确：视觉端点认证失败 / 限流 / 超时 / 后端不可用时返回 `ok:false`，主模型会停止视觉请求、继续文本任务，而不是换问法死磕。

## 工作原理

```
用户贴图 ──► host 持久化（durable attachment, id 如 sha256:...）
              │
              ▼
    stealth adapter（接管 deepseek-official，声明 image 输入）
              │  stream() 层改写：image block → 文本标记
              │    · 已描述过 → 内嵌缓存描述
              │    · autoCaption 开 → 先调视觉模型生成描述（阻塞）
              │    · 否则 → [图片「名」已上传，附件 id 为「sha256:...」，
              │              需要看图时调用 analyze_image 工具…]
              ▼
    委托给重建的原生 DeepSeek adapter（纯文本请求，不再报错）
              │
              ▼
    主模型判断需要看图 ──► analyze_image(attachmentIds, question)
                              │
                              ▼
              attachments.readImage 取字节 ──► OpenAI 兼容多模态端点
                              │
                              ▼
              文字答案回主模型（内容哈希缓存 + 写入图片描述记忆）
```

## 安装

```sh
dsh plugin --profile <name> add "Siq5005/dsh-plugins#path:/bundles/dsh-vision-adapter"
```

## 启用（二选一）

**A. 无感接管（推荐）**：在 profile 补丁层（`~/.dsh/profiles/<profile>/cordis.patch.yml`）禁用官方 llm-deepseek 行，插件自动接管 `deepseek-official` 路由——模型选择器外观不变，贴图即用：

```yaml
- id: llm-deepseek
  name: '@deepseek-ai/dsh-llm-deepseek'
  disabled: true
```

**B. 显式包装组**：官方行保留，模型选择器里选「DeepSeek (vision)」组（路由名 `deepseek-vision`）即可发图；纯文字仍可用官方组。

## 配置

`cordis.patch.yml`（改配置需重启）：

```yaml
- id: dsh-vision-adapter
  name: dsh-vision-adapter
  config:
    enabled: true
    # OpenAI 兼容多模态端点（含 /v1；支持 OpenAI / siliconflow / 智谱 / OpenRouter 等）
    baseURL: https://api.openai.com/v1
    apiKey: !!js process.env.VISION_API_KEY   # 建议环境变量注入，勿写死
    model: gpt-4o-mini                         # 或 qwen-vl-plus / glm-4v-flash 等
    autoCaption: false                         # true = 贴图自动生成描述（每次新图多一次视觉调用）
    captionPrompt: ''                          # 自动描述/工具 system 提示，留空用内置
    timeoutMs: 60000
    cacheSize: 500
    cacheTtlMs: 21600000                       # 问答缓存 6 小时
    takeover: true                             # 是否尝试接管 deepseek-official
    visionRoute: true                          # 是否注册 deepseek-vision 包装组
```

## 工具

### analyze_image

主模型"看图"入口。参数：`attachmentIds`（1-4 个附件 id，来自上下文 `[图片「...」]` 标记）+ `question`（具体问题）。成功返回文字答案；失败返回结构化 `{ok:false, code, retryable, reason}`。

## 已知边界

- 多模态调用消耗**你自己的第三方 API 额度**；图片字节以 base64 发给该端点（隐私自担）。
- `autoCaption: true` 时，含新图的请求会阻塞一次视觉调用（描述生成）再进主模型。
- 图片描述记忆与问答缓存为会话内内存缓存（重启清空）。
- 仅处理 `deepseek-official` 路由；自定义文本 provider 不受影响。

## 测试

```sh
cd bundles/dsh-vision-adapter
node --test --test-timeout=15000 test/*.test.js   # 43 个
```

## License

MIT
