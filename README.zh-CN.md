# remember-api

[English](README.md) | 简体中文

**一个由你自己运行的个人 AI 网关。**

网站：<https://remember-api.cn>

remember-api 把你的身份、偏好、项目记忆和模型路由放在一个 OpenAI 兼容 API 后面。Codex、Claude Code、Cursor、Cherry Studio、Open WebUI 等客户端可以连接到同一层个人状态，而不是各自保留一份互不相通的记忆。

记忆属于你。模型只是可替换的算力供应商。

![remember-api overview](docs/assets/remember-api-overview.svg)

## 它是什么

一句话：**换工具不换记忆，换模型不重新解释项目。**

- **OpenAI 兼容网关** —— 对外暴露 `/v1/models` 与 `/v1/chat/completions`，客户端只需要 Base URL、API Key 和 Model。
- **Profile-as-Model** —— 客户端里的 `model` 是 remember-api 的 Profile，不一定是厂商模型 id。Profile 决定 provider、上游模型、system prompt 和记忆预算。
- **API Key 隔离** —— 每把 API Key 只绑定一个 Profile，多个个人模型不会互相串用。
- **Project 级记忆边界** —— 长期偏好可复用，项目上下文有边界。
- **记忆成本可观察** —— Memory Budget 控制单次请求注入多少记忆，usage 记录 memory tokens、延迟和估算成本。
- **Provider 无关路由** —— 上游凭据和 provider 配置与客户端配置分离。
- **可替换记忆后端** —— 默认使用内置 DB memory provider；需要时可启用 Mem0 bridge。

![profile as model](docs/assets/profile-as-model.svg)

remember-api **不是**另一个聊天应用，不是普通 RAG，也不只是一个 Memory SDK。它是 AI 客户端和模型供应商之间那层可迁移的个人状态层。

## 对外 API 面

运行时产品面刻意保持很小：

| 入口        | 用途          | 鉴权             |
| --------- | ----------- | -------------- |
| `/v1/*`   | OpenAI 兼容网关 | Bearer API Key |
| `/health` | 静态探活        | 无              |

旧的 `/api` 管理面和 Web 控制台已移除。

客户端配置只有三项：

| 字段       | 含义                            |
| -------- | ----------------------------- |
| Base URL | 你的 remember-api 实例，以 `/v1` 结尾 |
| API Key  | 绑定到某个 Profile 的 key           |
| Model    | Profile 名；默认种子名是 `default`    |

Claude Code 原生使用 Anthropic 协议，不能直接连接这个 OpenAI-compatible `/v1/chat/completions` 端点。要让 Claude Code 共享 remember-api 记忆，需要在前面加 Anthropic → OpenAI 的协议翻译层。


## License

[MIT](LICENSE)
