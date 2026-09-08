# remember-api：完成目标与最终交付文档

## 1. 项目目标

remember-api 的最终目标是：

> **提供一个可被不同 AI 工作台调用的 Stateful AI API，让用户在 Claude Code、Codex、Cursor、DeepSeek Harness 等客户端之间切换时，仍然共享同一套个人记忆、项目记忆、Skill 和偏好。**

用户只需要配置：

```text
BASE_URL
API_KEY
MODEL
```

即可把 remember-api 当作普通 AI API 使用。

---

# 2. 核心问题

当前不同 AI Harness 的上下文彼此隔离。

例如：

```text
Claude Code
↓
已经理解项目、架构、历史决策

切换

DeepSeek Harness
↓
重新读项目
重新理解架构
重新询问用户
重新消耗 Token
```

remember-api 要解决：

```text
Claude Code ───────┐
Codex ─────────────┤
Cursor ────────────┼── remember-api
DeepSeek Harness ──┘        │
                            ↓
                      Shared Context
```

最终实现：

> **换工作台，不重新认识项目。**

---

# 3. 最终完成标准

项目完成后必须能够实现以下完整流程。

## 场景一：创建个人 Coding Profile

用户创建：

```text
Profile: xiao-coding
Provider: DeepSeek
Model: deepseek-xxx
```

并配置：

```text
用户偏好
项目记忆
Skills
Memory Budget
```

---

## 场景二：Claude Code 接入

Claude Code 配置：

```text
BASE_URL=https://api.remember.xxx/v1
API_KEY=remember_xxx
MODEL=xiao-coding
```

随后正常执行代码任务。

remember-api 自动：

```text
接收请求
↓
识别用户
↓
识别 Profile
↓
加载项目
↓
检索相关 Memory
↓
构建 Context
↓
调用 DeepSeek
↓
返回结果
↓
更新记忆
```

---

## 场景三：切换 Harness

用户随后切换到 DeepSeek Harness。

仍然配置：

```text
BASE_URL=https://api.remember.xxx/v1
API_KEY=remember_xxx
MODEL=xiao-coding
```

新的 Harness 应该能够直接知道：

* 当前项目是什么
* 项目使用什么技术栈
* 当前完成到哪里
* 之前做过什么设计决策
* 有哪些已知问题
* 用户有哪些长期偏好

不需要用户重新描述。

---

# 4. P0 最终交付范围

第一版必须形成一个真正可使用的 MVP。

---

## 4.1 OpenAI-Compatible API

完成：

```text
POST /v1/chat/completions
GET  /v1/models
```

必须支持：

* 普通请求
* Streaming
* System / User / Assistant Messages
* OpenAI-compatible Response
* OpenAI-compatible Error

目标：

> 主流支持自定义 OpenAI Endpoint 的 Harness 可以直接接入。

---

# 5. API Key 系统

完成 API Key：

```text
remember_xxxxxxxxx
```

支持：

* 创建
* 禁用
* 删除
* 用户隔离
* 请求鉴权

每个请求能够识别对应 User。

---

# 6. Profile 系统

完成 Profile CRUD。

Profile 至少包含：

```text
id
name
provider
baseModel
systemPrompt
projectId
memoryBudget
skills
```

示例：

```text
xiao-coding
zero-dev
remember-dev
```

客户端使用 Profile 名作为：

```json
{
  "model": "zero-dev"
}
```

---

# 7. Project 系统

完成项目管理。

每个 Project 至少保存：

```text
Name
Description
Summary
Architecture
Decisions
Status
Known Issues
```

保证不同 Project 的 Memory 相互隔离。

---

# 8. Memory Backend

第一版直接集成已有 Memory 工程，例如 Hermes。

需要完成统一适配层：

```ts
interface MemoryProvider {
  search()
  write()
  update()
  delete()
}
```

remember-api 不依赖具体实现。

未来可以更换：

```text
Hermes
ReMe
Mem0
Custom
```

而上层 API 不需要修改。

---

# 9. Memory Retrieval

每个请求能够根据：

```text
当前请求
+
当前 Profile
+
当前 Project
```

检索相关 Memory。

至少支持：

```text
Top-K
Similarity / Relevance
Project Scope
User Scope
```

返回结果进入 Context Builder。

---

# 10. Memory Budget

必须实现 Memory Token 限制。

例如：

```text
memoryBudget = 1500
```

一次请求最多允许：

```text
1500 Memory Tokens
```

超出后执行：

```text
排序
↓
裁剪
↓
只保留最高相关 Memory
```

第一版不要求复杂 Compression。

---

# 11. Context Builder

完成统一 Context 构建器。

基本结构：

```text
System Prompt
+
User Preference
+
Project Summary
+
Retrieved Memory
+
Skills
+
Harness Messages
```

然后发送到底层模型。

Context Builder 必须明确记录：

```text
Memory Tokens
Skill Tokens
Project Tokens
Original Message Tokens
```

---

# 12. Memory Write

第一版必须实现基础自动写入。

至少识别：

* 用户明确表达的长期偏好
* 重要项目状态变化
* 明确的架构决策
* 当前任务完成状态

不要求每轮都产生 Memory。

Memory Write 应该允许：

```text
skip
create
update
merge
```

---

# 13. DeepSeek Provider

MVP 第一版只要求完整支持 DeepSeek。

需要实现：

```text
DeepSeek Chat
DeepSeek Streaming
Token Usage
Cache Token Usage
Error Handling
```

remember-api 内部负责转换为统一 Provider 格式。

---

# 14. Usage Tracking

每次请求必须保存：

```text
User
Profile
Project
Provider
Model

Input Tokens
Cached Tokens
Output Tokens

Memory Tokens
Skill Tokens

Latency
Cost
Timestamp
```

---

# 15. Cost Dashboard

最终必须可以看到：

```text
Today
¥23.41

Input
8.2M

Cached
7.5M

Output
460K

Memory
320K

Memory Overhead
3.8%
```

核心目的是回答：

> **remember-api 到底额外消耗了多少 Token？**

---

# 16. Memory 管理页面

最终至少提供简单 Memory 管理页面。

用户能够：

* 查看 Memory
* 搜索 Memory
* 删除 Memory
* 修改 Memory
* Pin Memory
* 查看所属 Project

不要求第一版实现复杂知识图谱。

---

# 17. Profile 管理页面

支持：

```text
创建 Profile
修改 Base Model
绑定 Project
设置 Memory Budget
设置 System Prompt
绑定 Skill
```

---

# 18. Project 管理页面

支持查看：

```text
Project Summary
Architecture
Decisions
Status
Known Issues
Memory
```

允许人工修改错误的自动记忆。

---

# 19. 最终产品工作流

完整链路必须达到：

```text
             Claude Code
                  │
                  │
             OpenAI API
                  │
                  ▼
          ┌────────────────┐
          │  remember-api  │
          └───────┬────────┘
                  │
           Profile Resolve
                  │
           Project Resolve
                  │
          Memory Retrieval
                  │
           Memory Budget
                  │
          Context Builder
                  │
                  ▼
              DeepSeek
                  │
                  ▼
               Result
                  │
            Memory Write
                  │
                  ▼
             Shared State
```

然后：

```text
DeepSeek Harness
       │
       ▼
remember-api
       │
       ▼
同一 Shared State
```

---

# 20. 最终仓库建议

```text
remember-api/
│
├─ apps/
│  ├─ api/
│  └─ web/
│
├─ packages/
│  ├─ core/
│  ├─ memory/
│  ├─ providers/
│  ├─ profiles/
│  ├─ projects/
│  ├─ usage/
│  └─ shared/
│
├─ integrations/
│  └─ hermes/
│
├─ docs/
│  ├─ architecture.md
│  ├─ api.md
│  ├─ memory.md
│  └─ deployment.md
│
├─ README.md
└─ LICENSE
```

---

# 21. 最终交付物

项目完成时，应至少交付以下内容。

## 代码

* [ ] remember-api Server
* [ ] Web Dashboard
* [ ] DeepSeek Provider
* [ ] Hermes Memory Adapter
* [ ] Profile System
* [ ] Project System
* [ ] Usage Tracking
* [ ] Memory Budget
* [ ] Context Builder

## API

* [ ] `/v1/chat/completions`
* [ ] `/v1/models`
* [ ] Profile API
* [ ] Project API
* [ ] Memory API
* [ ] Usage API

## UI

* [ ] Overview
* [ ] Profiles
* [ ] Projects
* [ ] Memories
* [ ] Usage
* [ ] API Keys

## 文档

* [ ] README
* [ ] Quick Start
* [ ] Claude Code 接入说明
* [ ] DeepSeek Harness 接入说明
* [ ] API Reference
* [ ] Deployment Guide
* [ ] Architecture
* [ ] Memory 机制说明

---

# 22. 必须完成的 Demo

最终必须制作一个明确证明产品价值的 Demo。

## Step 1

使用 Claude Code + remember-api：

```text
实现一个功能 A
```

过程中产生：

```text
架构决策
项目状态
开发偏好
```

---

## Step 2

关闭 Claude Code。

打开 DeepSeek Harness。

---

## Step 3

使用同一个：

```text
BASE_URL
API_KEY
MODEL
```

输入：

```text
继续刚才的工作。
```

---

## Step 4

DeepSeek Harness 应该可以理解：

```text
刚刚在做什么
为什么这么做
做到什么阶段
下一步是什么
```

这就是 remember-api 最核心的 Demo。

---

# 23. MVP 验收指标

## 接入

至少两个不同 Harness 能成功调用。

目标：

```text
Claude Code
+
DeepSeek Harness
```

---

## 记忆连续性

切换 Harness 后，不重新提供项目介绍也能够继续任务。

---

## Memory 成本

目标：

```text
Memory Overhead
≤ 10%
```

理想：

```text
≤ 5%
```

---

## 隔离

不同项目之间不能产生明显 Memory 污染。

---

## 稳定性

连续使用过程中不能因为 Memory 系统导致：

* API 请求频繁失败
* Streaming 异常
* Context 超限
* 大量重复 Memory

---

# 24. 第一版成功条件

第一版并不需要证明 remember-api 拥有最先进的记忆算法。

只需要证明：

> **跨 Harness 共享 Context 是可用的。**

如果达到：

```text
Claude Code → remember-api → DeepSeek

切换

DeepSeek Harness → remember-api → DeepSeek
```

并且能够继续之前的项目工作，那么 MVP 就已经成立。

---

# 25. 后续再解决的问题

MVP 完成后再考虑：

* 自动项目识别
* cwd / Git Repo 识别
* Git Diff Memory
* Memory Compression
* Memory Rerank
* 更好的 Embedding
* 多 Provider
* Model Router
* Memory ROI
* Team Memory
* MCP
* 自定义 Skill 系统

这些不能阻塞第一版交付。

---

# 26. 最终用户体验

理想情况下，用户第一次配置：

```text
API Base:
https://api.remember.xxx/v1

API Key:
remember_xxx

Model:
xiao-coding
```

之后无论使用：

```text
Claude Code
Codex
Cursor
DeepSeek Harness
```

都连接到同一个：

```text
Personal Context
```

用户不需要关心：

```text
Memory DB
Embedding
RAG
Hermes
Context Injection
Memory Compression
```

这些全部由 remember-api 处理。

---

# 27. 最终产品定义

remember-api 最终交付的不是一个 Memory SDK。

而是：

> **一个可以直接当 AI 模型 API 使用的个人 AI 后端。**

它把：

```text
Identity
Memory
Projects
Preferences
Skills
```

绑定到用户，而不是绑定到具体客户端。

最终形成：

```text
           Your Context
               │
        ┌──────┴──────┐
        │ remember-api│
        └──────┬──────┘
               │
       OpenAI-compatible
               │
 ┌─────────────┼─────────────┐
 │             │             │
Claude Code   Codex    DeepSeek Harness
```

**模型可以换。**

**Harness 可以换。**

**记忆和个人上下文始终属于用户。**
