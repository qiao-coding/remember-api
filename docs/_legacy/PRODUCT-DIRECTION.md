# Production Direction — Stateful Personal AI API

**Purpose.** remember-api 是一个可被 Claude Code、Codex、Cursor、DeepSeek Harness 等客户端直接调用的 OpenAI-compatible API。它把个人记忆、项目记忆、偏好、Skills、Provider 配置和用量统计绑定到用户，而不是绑定到某一个 AI 工作台。

> **Core product invariant:** 工作台可以换，模型可以换，用户上下文不能丢。remember-api 负责 state；Harness 负责执行。

## 1. The product shape

remember-api 由四层组成：

| Layer | Role | Must be true |
|---|---|---|
| OpenAI-compatible gateway | 对外表现为普通模型 API | 客户端只配置 `BASE_URL / API_KEY / MODEL` |
| Context engine | 根据 Profile 组装系统上下文 | Memory 与 Skills 必须可计量、可裁剪 |
| Control plane | Web 后台管理配置和可观测性 | 用户能看、改、配、统计 |
| Adapter layer | 连接 Memory backend 和 Model provider | 上层不依赖具体供应商内部结构 |

## 2. The locked nouns

| Noun | Meaning |
|---|---|
| **User** | 数据隔离的根。所有 API Key、Profile、Project、Memory、Skill、Usage 都属于某个 User。 |
| **API Key** | `rma_` 开头的调用凭据，只用于 `/v1` 网关。数据库只存 hash。 |
| **Profile** | 客户端看到的 `model`。内部映射到 provider、base model、project、memory budget、skills。 |
| **Project** | 项目级上下文命名空间。不同 Project 的 Memory 默认不能互相注入。 |
| **Memory** | 可检索、可编辑、可固定的用户或项目记忆。 |
| **Skill** | 可绑定到 Profile 的 prompt fragment，第一版以 Markdown/TXT 内容为主。 |
| **Provider** | 模型供应商配置。V1 只要求 DeepSeek 完整可用。 |
| **RequestUsage** | 每次模型请求的 token、cost、latency 和 context overhead 记录。 |

## 3. Product principles

| Principle | Product implication |
|---|---|
| **Harness executes** | 不做 Agent workflow、不重复规划、不接管工具循环。 |
| **Profile is model** | `/v1/models` 返回 Profile，`/v1/chat/completions.model` 用 Profile name。 |
| **Project is a boundary** | Project A 的架构决策不能注入 Project B。 |
| **Memory is visible** | 自动写入的记忆必须能在 Web 端查看、编辑、删除、固定。 |
| **Memory has a budget** | 单次请求 Memory tokens 必须受 Profile/request budget 限制。 |
| **Cost is observable** | Dashboard 必须能回答“记忆额外烧了多少 token”。 |
| **Adapters are replaceable** | Mem0/Hermes/ReMe/DB backend 不应改变上层 API。 |

## 4. Context hierarchy

| Tier | Content | Injection rule |
|---|---|---|
| L0 Preference | 长期用户偏好、风格、技术栈 | 小、稳定、高优先级 |
| L1 Project Summary | 项目摘要、架构、状态、决策、问题 | 来自当前 Profile/Project |
| L2 Retrieved Memory | 与本轮请求相关的记忆 | Top-K + budget |
| L3 Raw History | 原始历史记录和长日志 | 默认不注入，只在必要时检索 |

## 5. What this changes in the code

| Area | Production direction |
|---|---|
| `apps/api` | 保持 Fastify gateway 简洁，优先稳定 `/v1` 兼容性。 |
| `packages/core` | Context Builder、Memory Budget、Token 估算是自研核心。 |
| `packages/memory` | 只暴露统一 MemoryProvider，不把 Mem0/Hermes 细节泄露到 API/Web。 |
| `packages/providers` | V1 深做 DeepSeek；其他 provider 只在进入实现周期后开放。 |
| `packages/db` | PostgreSQL/Drizzle 保存 control plane state 与 usage。 |
| `apps/web` | 管理后台只做看、改、配、统计，不做聊天产品。 |

## 6. What this design deliberately refuses

- 不做新的 Coding Agent。
- 不做第二层 autonomous tool loop。
- 不做复杂 multi-agent orchestration。
- 不自研 embedding model。
- 不自研 vector database。
- 不把 Handoff/Memory 写成不可审计的黑盒。
- 不为了炫技加入 LangGraph、Kafka、Kubernetes、Graph DB。

V1 的胜负点很窄：一个 Stateful API 能不能让两个不同 Harness 用同一套上下文继续工作。
