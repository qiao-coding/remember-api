# remember-api：架构设计与需求清单

## 1. 项目定位

**remember-api** 是一个带有长期记忆、项目记忆、个人偏好和 Skill 的个性化 AI API。

它对外提供 OpenAI-compatible API，使 Claude Code、Codex、Cursor、DeepSeek Harness 等不同 AI 工作台可以接入同一个 API，并共享同一套用户上下文。

核心目标：

> **让记忆属于用户，而不是属于某一个 Harness。**

典型场景：

```text
Claude Code ───────┐
Codex ─────────────┤
Cursor ────────────┼── remember-api ── DeepSeek / Claude / GPT
DeepSeek Harness ──┘        │
                            ├─ User Memory
                            ├─ Project Memory
                            ├─ Skills
                            └─ Preferences
```

用户即使切换工作台，也不需要重新解释：

* 项目是什么
* 当前做到哪里
* 为什么这样设计
* 已经尝试过什么
* 哪些方案失败过
* 用户的编码习惯
* 常用技术栈和偏好

---

# 2. 核心产品定义

remember-api 不是：

* 新的 AI IDE
* 新的 Coding Agent
* 新的 Agent Harness
* 单纯的向量数据库
* 单纯的 RAG 服务

它更接近：

> **Stateful Personal AI API**

普通模型 API：

```text
Request
  ↓
Model
  ↓
Response
```

remember-api：

```text
Request
  ↓
Profile
  ↓
User Memory
  ↓
Project Memory
  ↓
Skills
  ↓
Preferences
  ↓
Model
  ↓
Response
  ↓
Memory Update
```

底层模型可以更换。

工作台也可以更换。

但 Personal Context 保持一致。

---

# 3. 核心设计原则

## 3.1 Harness 负责执行

例如 Claude Code 继续负责：

```text
规划任务
↓
搜索代码
↓
读取文件
↓
修改代码
↓
执行命令
↓
测试
↓
继续修复
```

remember-api 不应该重新实现这一层。

---

## 3.2 remember-api 负责状态

remember-api 主要负责：

```text
识别 Profile
↓
识别 Project
↓
检索相关 Memory
↓
注入 Context
↓
调用模型
↓
更新 Memory
```

---

## 3.3 避免 Agent 套 Agent

不推荐：

```text
Claude Code Agent
        ↓
Hermes Agent
        ↓
DeepSeek
```

这样容易导致：

* 重复规划
* 重复推理
* 重复工具调用
* Token 消耗增加
* 延迟增加
* Harness 行为失控

推荐：

```text
Claude Code
     ↓
remember-api
     ↓
Memory Retrieve
     ↓
Context Build
     ↓
DeepSeek
     ↓
Memory Write
```

如果使用 Hermes，应尽量把 Hermes 作为：

> **Memory / Context Backend**

而不是第二层 Autonomous Agent。

---

# 4. 总体架构

```text
┌───────────────────────────────────────┐
│              AI Clients               │
│                                       │
│ Claude Code                           │
│ Codex                                 │
│ Cursor                                │
│ DeepSeek Harness                      │
│ Other OpenAI-compatible Clients       │
└─────────────────┬─────────────────────┘
                  │
                  │ OpenAI-compatible API
                  ▼
┌───────────────────────────────────────┐
│          remember-api Gateway         │
│                                       │
│ Authentication                        │
│ Profile Resolver                      │
│ Project Resolver                      │
│ Context Builder                       │
│ Memory Budget                         │
│ Model Router                          │
│ Usage Tracking                        │
└─────────────────┬─────────────────────┘
                  │
        ┌─────────┴─────────┐
        ▼                   ▼
┌────────────────┐  ┌──────────────────┐
│  Memory Layer  │  │   Model Layer    │
│                │  │                  │
│ Hermes Memory  │  │ DeepSeek         │
│ / ReMe         │  │ Claude           │
│ / Custom       │  │ GPT              │
└───────┬────────┘  │ Other Providers  │
        │           └──────────────────┘
        ▼
┌───────────────────────────────────────┐
│               Storage                 │
│                                       │
│ Profiles                              │
│ User Memory                           │
│ Project Memory                        │
│ Skills                                │
│ Projects                              │
│ Usage                                 │
│ Logs                                  │
└───────────────────────────────────────┘
```

---

# 5. API 设计

第一版优先兼容：

```text
POST /v1/chat/completions
```

后续可以考虑：

```text
POST /v1/responses
GET  /v1/models
```

请求示例：

```json
{
  "model": "zero-dev",
  "messages": [
    {
      "role": "user",
      "content": "继续处理剧情生成队列的问题"
    }
  ]
}
```

客户端认为：

```text
zero-dev = 一个模型
```

但 remember-api 内部解释为：

```text
zero-dev
├─ provider
├─ base model
├─ project
├─ memory namespace
├─ user preferences
├─ skills
└─ context policy
```

---

# 6. Profile 设计

remember-api 中的 `model` 更接近一个 **Profile ID**。

例如：

```text
xiao-coding
xiao-fast
zero-dev
remember-dev
writing
```

Profile 示例：

```ts
interface Profile {
  id: string;

  provider: string;
  model: string;

  systemPrompt?: string;

  userMemoryNamespace?: string;
  projectId?: string;

  skills?: string[];

  memoryBudget?: number;

  temperature?: number;
  maxTokens?: number;
}
```

示例：

```text
zero-dev
├─ Base Model: DeepSeek
├─ Project: CITIZEN-ZERO
├─ User Preference
├─ Project Memory
├─ React Skill
├─ Pixi Skill
├─ Fastify Skill
└─ Project Rules
```

---

# 7. Project 设计

Project 是 remember-api 中的重要一级实体。

```text
User
└─ Projects
   ├─ citizen-zero
   ├─ remember-api
   ├─ skill-framework
   └─ other-project
```

每个项目应该拥有独立 Namespace。

避免出现：

```text
A 项目的架构决策
被错误注入
B 项目的 Coding Context
```

---

# 8. Project Memory 结构

建议逻辑上拆分：

```text
Project Memory
├─ Summary
├─ Architecture
├─ Decisions
├─ Status
├─ Tasks
├─ Known Issues
├─ Failed Attempts
└─ History
```

例如：

### Summary

项目是什么。

### Architecture

当前技术架构。

### Decisions

重要设计决策以及原因。

### Status

当前开发进度。

### Tasks

接下来要完成什么。

### Known Issues

已知问题。

### Failed Attempts

已经验证不可行的方案。

---

# 9. User Memory

User Memory 保存跨项目稳定信息。

例如：

```text
用户主要使用 TypeScript
偏好 React 函数组件
偏向简单实现而不是过度抽象
使用 DeepSeek API 作为主要开发模型
倾向简洁代码
```

这些信息不应该重复存入每个 Project。

---

# 10. Memory 分层

建议使用四级 Memory。

## L0：Preference

长期稳定、高频使用。

例如：

```text
编码偏好
输出偏好
技术栈
常用工具
```

目标：

```text
100～500 tokens
```

---

## L1：Project Summary

对应项目的核心状态。

例如：

```text
项目定位
架构
当前阶段
关键约束
```

目标：

```text
300～1000 tokens
```

---

## L2：Retrieved Memory

根据当前请求动态检索。

例如用户问：

```text
继续之前 WebSocket 顺序队列的问题
```

可以检索：

```text
WebSocket
FIFO
剧情单元
Server Buffer
Socket.io
之前的架构决策
```

只取最相关 Top-K。

---

## L3：Raw History

完整历史：

```text
旧对话
原始记录
历史任务
旧决策
完整日志
```

默认不注入。

只在必要时检索。

---

# 11. Memory Budget

remember-api 必须把 Token 成本作为核心约束。

例如：

```text
Global Preference      200
Project Summary        500
Retrieved Memory       800
--------------------------
Memory Total          1500
```

支持：

```json
{
  "memoryBudget": 1500
}
```

还可以支持比例预算：

```text
Memory Tokens ≤ Current Context × 5%
```

超过预算后：

```text
Rerank
↓
降低 Top-K
↓
压缩低优先级 Memory
↓
删除弱相关 Memory
```

---

# 12. Context Builder

一次请求的 Context 构建：

```text
Client Request
      ↓
Resolve API Key
      ↓
Resolve Profile
      ↓
Resolve Project
      ↓
Load User Preference
      ↓
Load Project Summary
      ↓
Memory Search
      ↓
Rerank
      ↓
Apply Memory Budget
      ↓
Load Skills
      ↓
Build Prompt
      ↓
Call Model
```

最终发送给基础模型：

```text
System
├─ Profile Prompt
├─ User Preference
├─ Project Summary
├─ Relevant Memory
└─ Skills

Messages
└─ Harness Conversation
```

---

# 13. Memory Write

记忆写入不能每轮都使用昂贵模型。

推荐：

```text
Rules
↓
Structured Extraction
↓
Cheap Model
↓
Main Model
```

优先通过程序识别：

* Project
* Task 状态
* 文件修改
* Git diff
* 用户明确表达的偏好
* 用户明确要求记住的信息

LLM 主要负责判断：

* 哪些内容值得长期记住
* 哪些属于设计决策
* 哪些属于临时上下文
* 是否需要合并已有 Memory

---

# 14. Memory 生命周期

Memory 建议支持：

```text
temporary
working
project
long-term
pinned
```

### Temporary

仅当前任务有效。

### Working

当前阶段有效。

### Project

项目长期有效。

### Long-term

用户长期信息。

### Pinned

禁止自动删除或压缩。

---

# 15. Hermes 集成

第一阶段可以直接部署 Hermes Agent 作为 Memory Backend。

目标复用：

```text
Memory Storage
Memory Retrieval
Memory Summarization
Workspace
Skills
```

尽量避免使用：

```text
Planner
Autonomous Tool Loop
Agent Execution Loop
```

remember-api 只需要包装 Hermes 提供的底层能力。

---

# 16. Model Router

第一版 Profile 静态指定模型。

例如：

```text
xiao-fast
→ DeepSeek Flash

xiao-coding
→ DeepSeek

xiao-premium
→ Claude

zero-dev
→ DeepSeek
```

后续再考虑：

```text
简单任务
→ Cheap Model

Coding
→ DeepSeek

复杂推理
→ Claude / GPT
```

MVP 暂时不需要智能路由。

---

# 17. Provider 层

Provider 统一接口：

```ts
interface ModelProvider {
  chat(request: ChatRequest): Promise<ChatResponse>;
  stream(request: ChatRequest): AsyncIterable<ChatChunk>;
}
```

第一版：

```text
DeepSeekProvider
```

后续：

```text
OpenAIProvider
AnthropicProvider
OpenRouterProvider
CustomProvider
```

---

# 18. Authentication

用户通过：

```text
Authorization: Bearer remember_xxx
```

调用。

API Key 对应：

```text
User
├─ Profiles
├─ Projects
├─ Memories
└─ Usage
```

MVP 必须保证：

> 不同用户之间 Memory 完全隔离。

---

# 19. Usage Tracking

每次请求记录：

```text
Provider
Model
Profile
Project
Input Tokens
Cached Tokens
Output Tokens
Memory Tokens
Skill Tokens
System Tokens
Latency
Cost
```

示例：

```text
Profile: zero-dev
Model: DeepSeek

Input             30,240
Cache Hit             93%
Memory              1,020
Skills                380
Output              1,320

Memory Overhead       3.4%
Cost                 ¥0.07
```

---

# 20. Memory Cost 可观测性

remember-api 的重要产品能力：

> 用户应该清楚看到“记忆到底烧了多少 Token”。

Dashboard 可以显示：

```text
Base Context
Memory Context
Skill Context
Output
Cache Hit
Total Cost
```

避免用户产生：

> 开启记忆之后不知道为什么 API 费用突然变高。

---

# 21. Memory ROI

后续可以增加：

```text
Memory Cost
vs
Re-discovery Cost
```

例如：

```text
Memory Injected
1,100 tokens

Related Previous Context
8 files
4 architecture decisions
2 failed attempts

Estimated Context Saved
~7,000 tokens
```

remember-api 的目标不是：

> Memory 零成本。

而是：

> **Memory 成本显著低于重新理解上下文的成本。**

---

# 22. Skill 系统

Profile 可以绑定 Skill：

```text
zero-dev
├─ react
├─ typescript
├─ pixi
└─ project-rules
```

Skill 第一版支持：

```text
Markdown
TXT
System Prompt Fragment
```

后续再做：

```text
Skill Package
版本管理
依赖关系
Skill Marketplace
```

---

# 23. 文件导入

P1 支持用户导入：

```text
.md
.txt
```

用于：

```text
项目说明
架构
规则
Skill
知识资料
```

后续可以支持：

```text
URL
Git Repository
PDF
Docs
```

---

# 24. Project 自动识别

第一版通过 Profile 显式指定：

```text
model = zero-dev
```

映射：

```text
project = citizen-zero
```

后续可以通过：

```text
cwd
Git Repo
Repository URL
Metadata
Headers
```

自动识别。

例如：

```text
X-Remember-Project: citizen-zero
```

---

# 25. API 扩展字段

为了保持 OpenAI-compatible，默认不要求客户端修改请求格式。

但 remember-api 可以支持可选扩展：

```json
{
  "model": "xiao-coding",
  "messages": [],
  "remember": {
    "project": "remember-api",
    "memory": true,
    "memoryBudget": 1200
  }
}
```

无法支持自定义字段的 Harness 继续只使用：

```text
model
```

完成 Profile 解析。

---

# 26. Dashboard

后续 Web Dashboard：

## Overview

```text
API Usage
Token
Cost
Projects
Profiles
Memory
```

## Profiles

支持：

* 创建
* 修改
* 删除
* 模型绑定
* Project 绑定
* Skill 绑定

## Projects

支持：

* 查看项目
* Summary
* Architecture
* Decisions
* Status
* Tasks

## Memory

支持：

* 搜索
* 查看
* 修改
* 删除
* Pin
* Merge

## Usage

支持：

* Daily Cost
* Token Usage
* Cache Hit
* Memory Overhead
* Provider Cost

---

# 27. MVP 需求清单

## P0：API

* [ ] OpenAI-compatible `/v1/chat/completions`
* [ ] Streaming
* [ ] `/v1/models`
* [ ] API Key Authentication
* [ ] DeepSeek Provider
* [ ] OpenAI Request 转换
* [ ] OpenAI Response 转换

## P0：Profile

* [ ] 创建 Profile
* [ ] Profile → Base Model
* [ ] Profile → Provider
* [ ] Profile → Project
* [ ] Profile → Memory Namespace
* [ ] System Prompt
* [ ] Memory Budget

## P0：Project

* [ ] 创建 Project
* [ ] Project 隔离
* [ ] Project Summary
* [ ] Architecture
* [ ] Decisions
* [ ] Status

## P0：Memory

* [ ] Hermes / Memory Backend 接入
* [ ] User Memory
* [ ] Project Memory
* [ ] Memory Search
* [ ] Top-K
* [ ] Rerank
* [ ] Memory Write
* [ ] Memory Budget

## P0：Usage

* [ ] Input Token
* [ ] Output Token
* [ ] Cache Token
* [ ] Memory Token
* [ ] Skill Token
* [ ] Cost
* [ ] Latency

---

# 28. P1 需求

* [ ] Dashboard
* [ ] Profile 管理页面
* [ ] Project 管理页面
* [ ] Memory 管理页面
* [ ] Usage 页面
* [ ] Markdown 导入
* [ ] TXT 导入
* [ ] Skill
* [ ] Memory Pin
* [ ] Memory Merge
* [ ] Memory 编辑
* [ ] Claude Provider
* [ ] OpenAI Provider
* [ ] 自定义 Provider

---

# 29. P2 需求

* [ ] Repository 自动识别
* [ ] cwd 自动识别 Project
* [ ] Git diff → Memory
* [ ] Git commit → Project History
* [ ] 自动提取 Architecture Decision
* [ ] 自动维护 Project Summary
* [ ] 自动维护 Status
* [ ] Memory Compression
* [ ] Memory Lifecycle
* [ ] Memory ROI
* [ ] 自动 Model Routing
* [ ] URL Import
* [ ] MCP
* [ ] Team Workspace
* [ ] Shared Memory

---

# 30. 第一版明确不做

MVP 不做：

* 自研 Embedding Model
* 自研 Vector Database
* 自研完整 Autonomous Agent
* Agent Workflow
* Multi-Agent
* AI IDE
* 自动 Coding Agent
* Agent Marketplace
* Team Collaboration
* 复杂知识图谱
* 全自动模型路由

第一版重点是验证：

> 一个 Stateful API 能不能真正解决跨 Harness 的上下文连续性问题。

---

# 31. MVP 验证指标

## 31.1 跨 Harness 连续性

测试：

```text
Claude Code
→ 开发一个功能
→ 切换 DeepSeek Harness
```

第二个 Harness 是否能够快速理解：

* 项目背景
* 当前状态
* 架构
* 之前决策
* 当前任务

---

## 31.2 Memory Overhead

目标：

```text
Memory Overhead < 5%～10%
```

并且 Memory 带来的额外 Token：

```text
<
重新搜索仓库 + 重新理解项目产生的 Token
```

---

## 31.3 接入成本

目标：

AI Harness 只需要修改：

```text
BASE_URL
API_KEY
MODEL
```

即可接入 remember-api。

---

# 32. 推荐 MVP 技术架构

```text
Frontend
Next.js
Tailwind
shadcn/ui

Backend
Node.js
Fastify

Database
PostgreSQL

Memory
Hermes Agent / Existing Memory Backend

Provider
DeepSeek API

Cache
Redis（非必须，后续加入）
```

MVP 完全可以先：

```text
Fastify
+
SQLite / PostgreSQL
+
Hermes
+
DeepSeek
```

不需要一开始引入太多基础设施。

---

# 33. 项目目录建议

```text
remember-api/
├─ apps/
│  ├─ api/
│  └─ web/
│
├─ packages/
│  ├─ core/
│  ├─ memory/
│  ├─ providers/
│  ├─ profiles/
│  └─ shared/
│
├─ integrations/
│  └─ hermes/
│
└─ docs/
```

核心：

```text
packages/core
├─ context-builder
├─ project-resolver
├─ profile-resolver
├─ memory-budget
└─ usage
```

---

# 34. 核心数据实体

第一版只需要：

```text
User
APIKey
Profile
Project
Memory
Skill
RequestUsage
```

关系：

```text
User
├─ API Keys
├─ Profiles
├─ Projects
└─ Global Memories

Profile
├─ Provider
├─ Model
├─ Project
└─ Skills

Project
└─ Memories
```

---

# 35. 一句话产品描述

开发者版本：

> **remember-api 是一个 OpenAI-compatible 的 Stateful AI API，让 Claude Code、Codex、Cursor 和其他 AI Harness 共用同一套个人与项目记忆。**

更短版本：

> **One API. Same memory. Any AI client.**

中文：

> **换模型，换工作台，不换记忆。**

---

# 36. 项目核心

remember-api 最重要的不是“记忆算法”。

真正的核心抽象是：

> **把 Personal Context 从具体 AI Harness 中独立出来，再通过标准模型 API 提供给任何客户端。**

最终形成：

```text
                    remember-api
                         │
          ┌──────────────┼──────────────┐
          │              │              │
       Identity        Memory         Skills
          │              │              │
          └──────────────┼──────────────┘
                         │
                      Profile
                         │
                 OpenAI-compatible
                         │
       ┌─────────────────┼─────────────────┐
       │                 │                 │
Claude Code           Codex        DeepSeek Harness
```

**Harness 可以换。**

**模型可以换。**

**用户的上下文不换。**
