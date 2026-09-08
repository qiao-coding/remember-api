# remember-api：技术选型与功能设计

## 1. 技术目标

remember-api 第一版重点不是重新实现一套复杂 Memory Framework，而是尽快完成：

> **OpenAI-compatible API + Personal / Project Memory + Profile + Usage Tracking**

核心要求：

* 能接 Claude Code / DeepSeek Harness / Codex 等客户端
* 能共享长期记忆
* 能隔离不同项目
* Memory Token 成本可控
* 后续方便替换 Memory Backend 和模型 Provider

---

# 2. 总体技术栈

推荐：

```text
Frontend
Next.js
TypeScript
Tailwind CSS
shadcn/ui

Backend
Node.js
TypeScript
Fastify

Database
PostgreSQL

ORM
Drizzle ORM

Memory Backend
Hermes Agent / Hermes Memory

Cache
Redis（P1）

Model Provider
DeepSeek API

Validation
Zod

Authentication
API Key + Hash

Deployment
Docker
Vercel（Frontend）
Railway / Fly.io / VPS（API）
```

MVP 最小版本可以进一步缩成：

```text
Fastify
+
PostgreSQL
+
Drizzle
+
Hermes
+
DeepSeek
+
Next.js
```

---

# 3. Backend

## Fastify

推荐使用：

```text
Fastify + TypeScript
```

原因：

* API 项目非常合适
* 性能好
* Streaming 支持方便
* Plugin 架构清晰
* Schema / Validation 比较自然
* 适合做 OpenAI-compatible Gateway

主要负责：

```text
/v1/chat/completions
/v1/models

/api/profiles
/api/projects
/api/memories
/api/usage
/api/keys
```

---

# 4. Frontend

使用：

```text
Next.js
+
Tailwind CSS
+
shadcn/ui
```

Web 端主要是管理后台，不负责核心 Agent 工作流。

页面：

```text
Dashboard
Profiles
Projects
Memory
Usage
API Keys
Settings
```

第一版不需要复杂动画和视觉系统，重点是信息密度和可观测性。

---

# 5. 数据库

推荐：

```text
PostgreSQL
```

存储：

* User
* API Key
* Profile
* Project
* Skill
* Memory Metadata
* Request Usage
* Provider Config

Memory 原始数据如果 Hermes 自己管理，可以先继续保存在 Hermes 中。

PostgreSQL 保存 remember-api 自己的：

```text
用户关系
配置
Namespace
索引
Usage
```

---

# 6. ORM

推荐：

```text
Drizzle ORM
```

相比重量级 ORM，更适合这个项目：

* TypeScript 类型友好
* Schema 比较直观
* 控制 SQL 更方便
* 工程体积小
* 后续做复杂查询比较自由

---

# 7. Memory Backend

MVP：

```text
Hermes
```

remember-api 不直接依赖 Hermes 业务代码，而是定义 Adapter：

```ts
interface MemoryProvider {
  search(input: MemorySearchInput): Promise<MemoryItem[]>;
  write(input: MemoryWriteInput): Promise<void>;
  update(id: string, input: MemoryUpdateInput): Promise<void>;
  delete(id: string): Promise<void>;
}
```

实现：

```text
HermesMemoryProvider
```

未来可以增加：

```text
Mem0MemoryProvider
ReMeMemoryProvider
LocalMemoryProvider
```

这样不会被某一个 Memory Framework 锁死。

---

# 8. Provider Layer

模型层同样抽象。

```ts
interface ModelProvider {
  chat(request: ChatRequest): Promise<ChatResponse>;

  stream(
    request: ChatRequest
  ): AsyncIterable<ChatChunk>;
}
```

MVP：

```text
DeepSeekProvider
```

P1：

```text
OpenAIProvider
AnthropicProvider
OpenRouterProvider
```

---

# 9. Profile

Profile 是 remember-api 的核心实体。

例如：

```text
zero-dev
remember-dev
xiao-coding
```

Profile 保存：

```ts
type Profile = {
  id: string;
  name: string;

  provider: string;
  model: string;

  projectId?: string;

  systemPrompt?: string;

  memoryEnabled: boolean;
  memoryBudget: number;

  skillIds: string[];

  temperature?: number;
  maxTokens?: number;
};
```

客户端：

```json
{
  "model": "zero-dev"
}
```

内部：

```text
zero-dev
↓
DeepSeek
↓
Project A
↓
Project Memory
↓
Coding Preferences
↓
Skills
```

---

# 10. Project

Project 用来解决项目记忆隔离。

数据：

```ts
type Project = {
  id: string;
  name: string;

  description?: string;

  summary?: string;
  architecture?: string;
  status?: string;

  memoryNamespace: string;
};
```

不同项目：

```text
citizen-zero
remember-api
skill-framework
```

分别拥有独立 Memory Namespace。

---

# 11. Memory 数据结构

remember-api 自己至少需要统一 Memory 格式：

```ts
type Memory = {
  id: string;

  userId: string;
  projectId?: string;

  type:
    | "preference"
    | "decision"
    | "status"
    | "task"
    | "issue"
    | "history";

  content: string;

  importance: number;

  pinned: boolean;

  createdAt: Date;
  updatedAt: Date;
};
```

Hermes 内部可以有自己的结构，Adapter 负责转换。

---

# 12. Memory Retrieval

一次请求：

```text
User Message
↓
Memory Query Builder
↓
Hermes Search
↓
Top-K
↓
Rerank
↓
Memory Budget
↓
Context
```

第一版 Top-K 可以简单使用：

```text
Top 5
Top 10
```

不需要一开始自己实现复杂 reranker。

---

# 13. Memory Budget

必须做。

Profile：

```text
memoryBudget = 1500
```

意味着：

```text
本轮最多加入 1500 tokens Memory
```

裁剪优先级：

```text
Pinned
↓
High Relevance
↓
Project Decision
↓
Project Status
↓
Preference
↓
Other Memory
```

---

# 14. Context Builder

这是 remember-api 最核心的自研模块之一。

输入：

```text
Profile
Project
User Memory
Retrieved Memory
Skills
Client Messages
```

输出：

```text
Final Model Messages
```

例如：

```text
System

[Profile]
You are...

[User Preferences]
...

[Project]
...

[Relevant Memory]
...

[Skills]
...

User / Assistant Messages
...
```

Context Builder 同时计算：

```text
profileTokens
projectTokens
memoryTokens
skillTokens
messageTokens
```

---

# 15. Token 计算

建议使用模型对应 tokenizer。

如果 DeepSeek tokenizer 接入麻烦，MVP 可以：

```text
字符估算
+
Provider 返回的 Usage 做最终统计
```

重点是最终 Usage 必须以 Provider 返回值为准。

---

# 16. Usage Tracking

数据表：

```ts
type RequestUsage = {
  id: string;

  userId: string;
  profileId: string;
  projectId?: string;

  provider: string;
  model: string;

  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;

  memoryTokens: number;
  skillTokens: number;

  latencyMs: number;

  estimatedCost: number;

  createdAt: Date;
};
```

---

# 17. API Key

格式：

```text
rma_xxxxxxxxxxxxx
```

数据库不要存明文：

```text
API Key
↓
Hash
↓
Database
```

请求：

```text
Authorization: Bearer rma_xxx
```

Gateway：

```text
验证 API Key
↓
获取 User
↓
执行请求
```

---

# 18. OpenAI-Compatible API

## POST /v1/chat/completions

支持：

```json
{
  "model": "zero-dev",
  "messages": [],
  "stream": true
}
```

响应必须尽量保持 OpenAI 兼容。

支持：

* streaming
* non-streaming
* usage
* errors
* model field

---

# 19. Streaming

推荐直接使用：

```text
SSE
```

流程：

```text
DeepSeek Stream
↓
Provider Adapter
↓
OpenAI Chunk Formatter
↓
SSE
↓
Claude Code / Harness
```

这一层必须尽量少做 Buffer，避免 Coding Agent 延迟明显增加。

---

# 20. GET /v1/models

返回 Profile：

```json
{
  "data": [
    {
      "id": "xiao-coding",
      "object": "model"
    },
    {
      "id": "zero-dev",
      "object": "model"
    }
  ]
}
```

对客户端而言：

> Profile 就是 Model。

---

# 21. Memory Write

推荐异步逻辑：

```text
Model Response
↓
Memory Candidate Detector
↓
判断是否值得保存
↓
Memory Writer
```

第一版可以只保存：

### 用户明确内容

例如：

```text
以后这个项目全部使用 pnpm。
```

### Architecture Decision

例如：

```text
决定使用 WebSocket，而不是 SSE。
```

### Project Status

例如：

```text
认证模块已经完成。
```

### Failed Attempt

例如：

```text
尝试方案 A，因为 xxx 无法使用。
```

---

# 22. Memory 去重

必须有基础去重，否则用久了 Memory 会爆炸。

MVP 可以：

```text
新 Memory
↓
检索相似 Memory
↓
相似度高
↓
Update / Merge
```

而不是：

```text
永远 append
```

---

# 23. Skill

第一版 Skill 可以非常简单。

数据库：

```ts
type Skill = {
  id: string;
  name: string;
  content: string;
  tokenCount: number;
};
```

来源：

```text
Markdown
TXT
手动输入
```

Profile：

```text
skillIds[]
```

Context Builder 按需注入。

---

# 24. Dashboard 功能

## Overview

显示：

```text
Today's Requests
Today's Tokens
Today's Cost
Cache Hit
Memory Overhead
```

---

## Profiles

功能：

* 创建
* 修改
* 删除
* Provider
* Base Model
* Project
* Memory Budget
* Skills

---

## Projects

功能：

* 创建
* 修改
* 删除
* Summary
* Architecture
* Status
* Memory

---

## Memory

功能：

* 搜索
* 查看
* 修改
* 删除
* Pin
* 查看来源
* 查看所属项目

---

## Usage

支持按：

```text
Today
7 days
30 days
```

查看：

```text
Requests
Input Tokens
Output Tokens
Cache
Memory
Cost
```

---

## API Keys

功能：

* 创建 Key
* 删除
* 禁用
* 查看最后调用时间

只在创建时显示完整 Key。

---

# 25. Repository Structure

推荐 Monorepo：

```text
remember-api/
├─ apps/
│  ├─ api/
│  │  └─ Fastify
│  │
│  └─ web/
│     └─ Next.js
│
├─ packages/
│  ├─ core/
│  │  ├─ context-builder
│  │  ├─ memory-budget
│  │  └─ token
│  │
│  ├─ memory/
│  │  ├─ types
│  │  └─ hermes
│  │
│  ├─ providers/
│  │  ├─ base
│  │  └─ deepseek
│  │
│  ├─ db/
│  │  ├─ schema
│  │  └─ client
│  │
│  └─ shared/
│
└─ docs/
```

包管理器：

```text
pnpm workspace
```

---

# 26. 数据实体

MVP 数据库表：

```text
users

api_keys

profiles

projects

skills

profile_skills

memories

request_usage
```

如果 Hermes 自己保存 Memory：

```text
memories
```

可以只作为 Metadata / Cache，而不一定存完整内容。

---

# 27. 核心功能优先级

## P0

必须完成：

* OpenAI-compatible API
* Streaming
* DeepSeek Provider
* API Key
* Profile
* Project
* Hermes Memory
* Memory Retrieval
* Memory Write
* Memory Budget
* Context Builder
* Usage Tracking

---

# 28. P1

第二阶段：

* Dashboard
* Memory Editor
* Skill
* Markdown / TXT Import
* 多 Provider
* Memory Pin
* Memory Merge
* Usage Chart
* Project Summary 自动维护

---

# 29. P2

后续：

* Git Repository 识别
* cwd 识别
* Git Diff Memory
* 自动 Architecture Decision
* Memory Compression
* Model Router
* MCP
* Team
* Memory Share
* URL Import

---

# 30. MVP 不建议使用的技术

第一版暂时不要引入：

```text
LangGraph
复杂 Multi-Agent
Kafka
Kubernetes
自研 Vector DB
复杂 Event Bus
Graph Database
微服务
```

remember-api 第一版本质上就是：

```text
API Gateway
+
Context Engine
+
Memory Backend
+
Model Provider
```

一个 Fastify 服务完全足够。

---

# 31. 最值得自己实现的部分

现成组件负责：

```text
Hermes
→ Memory

DeepSeek
→ Model

PostgreSQL
→ Storage

Next.js
→ Dashboard
```

remember-api 真正需要自己做好的是：

```text
OpenAI-compatible Gateway
Profile
Project Isolation
Context Builder
Memory Budget
Usage Tracking
Memory / Provider Adapter
```

其中最核心的是：

> **Context Builder + Memory Budget + 跨 Harness API 兼容。**

这些才是真正决定 remember-api 是否有价值的部分。

---

# 32. MVP 最终形态

```text
Claude Code
       │
       │ OpenAI API
       ▼
┌──────────────────┐
│   remember-api   │
├──────────────────┤
│ Auth             │
│ Profile          │
│ Project          │
│ Context Builder  │
│ Memory Budget    │
│ Usage            │
└───────┬──────────┘
        │
   ┌────┴────┐
   ▼         ▼
Hermes    DeepSeek
```

然后换成：

```text
DeepSeek Harness
       │
       ▼
remember-api
```

依然得到相同的：

```text
User Memory
Project Memory
Preferences
Skills
```

这就是第一版需要完成的全部核心能力。
