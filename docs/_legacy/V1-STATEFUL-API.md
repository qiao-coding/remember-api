# V1 — Stateful API MVP

> OpenAI-compatible gateway with user-owned memory.

**Two surfaces · seven core entities · one production provider · two memory backends.**

V1 只证明一件事：用户从 Harness A 切到 Harness B 后，不需要重新解释项目，新的 Harness 能通过同一个 `BASE_URL / API_KEY / MODEL` 继续理解当前工作。

## 1. The two-layer API

**Compatible surface.** 客户端看到的是普通 OpenAI API：

```text
GET  /v1/models
POST /v1/chat/completions
```

**Personal context layer.** remember-api 内部把 `model` 解析成 Profile，再加载 User、Project、Memory、Skills 和 Provider 配置。

```text
Client request
→ API Key
→ Profile
→ Project
→ Memory retrieval
→ Memory budget
→ Context builder
→ DeepSeek
→ Usage
→ Memory write
```

## 2. The V1 ladder

| Rung | Name | What changes | Counts when |
|---|---|---|---|
| 1 | Gateway works | 客户端能把 remember-api 当模型 API 调 | stream 与 non-stream 都成功 |
| 2 | Context works | Profile/Project/Memory/Skills 被正确注入 | 当前项目没有跨项目污染 |
| 3 | Control works | 用户能在 Web 后台配置资源 | 不需要手改数据库完成接入 |
| 4 | Memory closes | 请求后重要偏好/决策/状态能沉淀 | Web 可见、可改、可删、可固定 |
| 5 | Cost is visible | 每次请求记录 token/cost/latency | Usage 页面能解释 memory overhead |

## 3. The build

### API Gateway

**Why it is in V1.** 这是产品入口。没有 OpenAI-compatible 网关，就不能接 Claude Code、Codex、Cursor 和其他客户端。

Required:

- `GET /v1/models` 返回当前用户 Profiles。
- `POST /v1/chat/completions` 支持 OpenAI-style messages。
- 支持 `stream: true` SSE。
- 支持 OpenAI-compatible error shape。
- 支持扩展字段 `remember.memory`、`remember.memoryBudget`、`remember.project`。

Deferred:

- `/v1/responses`
- tools/function calling 深兼容
- 多 provider 智能路由

### Identity and tenant isolation

**Why it is in V1.** 记忆属于用户，隔离失败就是产品失败。

Required:

- `/v1` 使用 `Authorization: Bearer rma_...`。
- API Key 只保存 hash。
- `/api` 使用 Supabase JWT。
- 所有管理 API 按 `userId` 过滤。
- Project/Profile/Memory/Key 跨用户访问返回 401/404/400。

Deferred:

- API Key scopes
- rate limiting
- team workspace

### Profile and Project

**Why it is in V1.** Profile 是客户端的 `model`，Project 是记忆边界。

Required:

- Profile CRUD。
- Profile 绑定 provider/base model/project/system prompt/memory budget/skills。
- Project CRUD。
- Project 保存 summary、architecture、status、decisions、known issues。
- 请求级 `remember.project` 可以覆盖 Profile 默认 Project。

Deferred:

- cwd/git remote 自动识别项目
- Profile clone/template
- 自动维护 Project Summary

### Memory

**Why it is in V1.** 这是跨 Harness 连续性的核心。

Required:

- MemoryProvider interface。
- DB fallback。
- Mem0 bridge adapter。
- search/list/get/write/update/delete。
- 全局偏好和项目记忆分层检索。
- Memory Budget 裁剪。
- 回合结束后异步写入偏好、决策、状态、失败尝试。

Deferred:

- LLM structured extraction
- merge UI
- lifecycle/compression
- Memory ROI

### Web Console

**Why it is in V1.** 用户必须能看见 remember-api 记住了什么、怎么配置、花了多少。

Required:

- Login。
- Dashboard。
- Profiles。
- Projects。
- Memories。
- Skills。
- Usage。
- API Keys。
- Providers。
- Docs。
- Settings。

Deferred:

- 全局搜索。
- request detail drilldown。
- onboarding wizard。
- advanced import。

## 4. What has to be true for V1 to count

V1 成立时，下面流程必须能跑通：

1. 用户登录 Web 后台。
2. 配置 DeepSeek Provider。
3. 创建 Project。
4. 创建 Profile 并绑定 Project。
5. 创建 `rma_` API Key。
6. Harness A 使用 `BASE_URL / API_KEY / MODEL` 调用。
7. 请求产生 usage 和至少一条可解释记忆。
8. 用户在 Web 端看到并可编辑该记忆。
9. Harness B 使用同一配置输入“继续刚才的工作”。
10. Harness B 能说出项目状态、关键决策和下一步。

如果这个 demo 成立，remember-api 的第一版产品假设就成立。
