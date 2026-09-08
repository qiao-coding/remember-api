# remember-api：网站开发需求、技术选型与完成效果

## 1. 网站定位

remember-api 网站不是 AI 聊天网站，而是：

> **Personal AI API 的管理后台。**

网站负责管理：

- API Key
- Profile
- Project
- Memory
- Skill
- Provider
- Usage
- Cost
- 接入文档

实际 AI 请求仍然通过：

```text
Claude Code / Codex / Cursor / DeepSeek Harness
                    ↓
              remember-api
                    ↓
                 Model
```

网站主要解决：

> **看、改、配、统计。**

***

# 2. 最终网站结构

推荐：

```text
/
├─ /
│  └─ Landing Page
│
├─ /dashboard
│  └─ 总览
│
├─ /profiles
│  └─ Profile 管理
│
├─ /projects
│  └─ Project 管理
│
├─ /memories
│  └─ Memory 管理
│
├─ /skills
│  └─ Skill 管理
│
├─ /usage
│  └─ Token / Cost
│
├─ /api-keys
│  └─ API Key
│
├─ /providers
│  └─ 模型 Provider
│
├─ /docs
│  └─ 接入文档
│
└─ /settings
   └─ 用户设置
```

***

# 3. Landing Page

首页目标：

> 让用户十秒内理解 remember-api 是什么。

首屏建议：

```text
remember-api

One API.
Same memory.
Any AI client.

让 Claude Code、Codex、Cursor 和其他 AI Harness
共享同一套个人与项目记忆。

[Get Started] [View Docs]
```

下面展示核心架构：

```text
Claude Code ───────┐
Codex ─────────────┤
Cursor ────────────┼── remember-api ── DeepSeek
DeepSeek Harness ──┘        │
                            ├─ Memory
                            ├─ Projects
                            ├─ Skills
                            └─ Preferences
```

核心卖点控制在三个：

### Cross-Harness Memory

切换 AI 工作台，不重新解释项目。

### Personal AI API

每个 Profile 都有自己的：

```text
Model
Memory
Project
Skills
Preferences
```

### Observable Cost

明确看到：

```text
Memory Tokens
Cached Tokens
Input Tokens
Output Tokens
Cost
```

***

# 4. Dashboard

登录后的默认页面。

目标：

> 一眼知道 API 今天使用得怎么样。

顶部统计卡片：

```text
Requests Today
1,284

Cost Today
¥18.42

Input Tokens
8.2M

Cache Hit
92.8%

Memory Overhead
3.7%
```

下方：

```text
Usage Trend
Cost Trend
Token Breakdown
```

最近请求：

```text
Profile        Project          Model       Tokens       Cost

zero-dev       citizen-zero     DeepSeek    42K          ¥0.08
remember-dev   remember-api     DeepSeek    21K          ¥0.04
xiao-coding    -                DeepSeek    16K          ¥0.03
```

***

# 5. Profile 页面

这是网站最核心的页面之一。

Profile 列表：

```text
xiao-coding
DeepSeek
Global

zero-dev
DeepSeek
citizen-zero

remember-dev
DeepSeek
remember-api
```

点击 Profile 进入详情。

配置：

```text
Profile Name

Provider
DeepSeek

Base Model
deepseek-xxx

Project
remember-api

Memory
Enabled

Memory Budget
1500 tokens

System Prompt

Skills
React
TypeScript
Fastify
```

底部提供：

```text
Connection
```

例如：

```text
Base URL
https://api.remember.xxx/v1

Model
remember-dev
```

方便复制到 Harness。

***

# 6. Project 页面

Project 列表：

```text
remember-api
citizen-zero
skill-framework
```

Project Detail 推荐做成类似开发者 Workspace：

```text
remember-api
```

Tabs：

```text
Overview
Memory
Decisions
Status
Skills
Usage
```

***

## Overview

展示：

```text
Description

Architecture

Tech Stack

Current Status

Known Issues
```

***

## Decisions

例如：

```text
2026-08-18

Use Fastify instead of NestJS

Reason:
API Gateway 结构简单，
不需要 NestJS 带来的额外复杂度。
```

***

## Status

例如：

```text
Current Phase
MVP

Completed
- OpenAI-compatible API
- DeepSeek Provider

In Progress
- Hermes integration

Next
- Memory Budget
```

***

# 7. Memory 页面

这是 remember-api 最有辨识度的管理页面。

顶部：

```text
Search memories...
```

过滤：

```text
All
Global
Project
Preference
Decision
Status
Issue
Pinned
```

Memory Item：

```text
Decision

remember-api 使用 Fastify 作为 API Server。

Project
remember-api

Importance
High

Updated
2 hours ago
```

操作：

```text
Edit
Pin
Delete
```

***

# 8. Memory Detail

点击 Memory：

```text
Content

Type

Project

Importance

Created At

Updated At

Source

Related Memories
```

允许用户人工纠错。

这是必须功能，因为自动 Memory 不可能永远正确。

***

# 9. Memory 成本展示

建议在 Memory 页面增加：

```text
Memory Usage Today
320K tokens

Memory Overhead
3.8%

Average / Request
249 tokens
```

这是 remember-api 很重要的差异化信息。

***

# 10. Skill 页面

Skill 第一版不要复杂化。

列表：

```text
React
TypeScript
Fastify
Project Rules
Writing Style
```

Skill Detail：

```text
Name

Description

Content

Estimated Tokens

Used By Profiles
```

支持：

```text
Create
Edit
Delete
Import Markdown
```

***

# 11. Usage 页面

重点展示：

```text
Token
Cost
Cache
Memory
```

顶部时间选择：

```text
24h
7d
30d
Custom
```

主要图表：

### Cost

```text
Daily Cost
```

### Tokens

拆分：

```text
Input
Cached
Output
Memory
Skill
```

### Profile Usage

例如：

```text
zero-dev        ¥14.20
remember-dev    ¥8.42
xiao-coding     ¥3.10
```

### Project Usage

例如：

```text
citizen-zero    48%
remember-api    31%
other           21%
```

***

# 12. Request Detail

后续可以查看单次请求：

```text
Request ID

Profile
remember-dev

Project
remember-api

Provider
DeepSeek

Input
32,402

Cached
29,104

Memory
1,024

Skills
340

Output
1,482

Latency
4.8s

Cost
¥0.07
```

这对 Debug Memory Token 特别有用。

***

# 13. API Keys 页面

展示：

```text
Name           Key             Last Used
Claude Code    rma_••••9abc    2 min ago
Codex          rma_••••128f    Yesterday
```

操作：

```text
Create
Disable
Delete
```

创建 Key 后只显示一次：

```text
rma_xxxxxxxxxxxxxxxxx
```

并提示保存。

***

# 14. Provider 页面

MVP：

```text
DeepSeek
Connected
```

配置：

```text
API Key
Base URL
Default Model
```

未来：

```text
OpenAI
Anthropic
OpenRouter
Custom OpenAI-compatible Provider
```

用户自己的 Provider Key 应加密存储。

***

# 15. Docs 页面

文档必须重点服务“快速接入”。

首页：

```text
Quick Start
```

步骤：

```text
1. Create API Key
2. Create Profile
3. Configure your AI client
4. Start using remember-api
```

需要独立文档：

```text
Claude Code
Codex
Cursor
DeepSeek Harness
OpenAI-compatible Clients
```

***

# 16. Onboarding

新用户第一次进入：

```text
Welcome to remember-api
```

建议只走三个步骤。

### Step 1

连接模型：

```text
DeepSeek API Key
```

### Step 2

创建 Profile：

```text
xiao-coding
```

### Step 3

生成：

```text
Base URL
API Key
Model
```

最后：

```text
You're ready.
```

不要做十几步复杂 onboarding。

***

# 17. UI 风格

remember-api 是开发者工具。

推荐：

> **现代、克制、高信息密度的 Developer Dashboard。**

不要：

- 大量渐变
- AI 蓝紫光污染
- 夸张玻璃效果
- 大量装饰动画
- 营销 SaaS 模板感

参考感觉：

```text
Vercel
Linear
GitHub
Raycast
Resend
```

特点：

- 黑白灰为主
- 少量品牌色
- 清晰边框
- 小圆角
- 高信息密度
- 代码字体合理使用
- Dark Mode 优先适配

***

# 18. 页面布局

Desktop：

```text
┌──────────────────────────────────────────┐
│ remember-api                    User     │
├────────────┬─────────────────────────────┤
│ Dashboard  │                             │
│ Profiles   │                             │
│ Projects   │        Main Content         │
│ Memories   │                             │
│ Skills     │                             │
│ Usage      │                             │
│ API Keys   │                             │
│ Docs       │                             │
│ Settings   │                             │
└────────────┴─────────────────────────────┘
```

左侧固定 Sidebar。

顶部只保留：

```text
Search
Theme
User
```

***

# 19. 响应式需求

第一版重点：

```text
Desktop
≥ 1024px
```

手机只要求：

- 页面不崩
- 基础查看
- Memory 编辑
- API Key 管理

不需要为手机设计完整开发者工作流。

***

# 20. 前端技术选型

推荐：

```text
Next.js
TypeScript
Tailwind CSS
shadcn/ui
```

具体：

```text
Next.js App Router
React
TypeScript
Tailwind CSS
shadcn/ui
Lucide Icons
```

***

# 21. 数据请求

推荐：

```text
TanStack Query
```

负责：

```text
Profiles
Projects
Memory
Usage
API Keys
```

优势：

- Query Cache
- Mutation
- Loading
- Error
- Refetch

Dashboard 数据很多，TanStack Query 很适合。

***

# 22. 表单

使用：

```text
React Hook Form
+
Zod
```

用于：

```text
Profile
Project
Provider
API Key
Skill
```

***

# 23. 图表

推荐：

```text
Recharts
```

只用于：

```text
Token Trend
Cost Trend
Usage Breakdown
```

不要到处塞图表。

***

# 24. Code Display

推荐：

```text
Shiki
```

主要用在：

```text
API Examples
Claude Code Config
curl
JSON
```

***

# 25. Authentication

如果第一版是个人自用：

可以暂时：

```text
Single User
```

直接通过管理员账户进入。

如果准备公开：

推荐：

```text
Better Auth
```

支持：

```text
Email
GitHub
```

MVP 不需要自己写复杂认证系统。

***

# 26. 后端技术选型

```text
Node.js
TypeScript
Fastify
Zod
Drizzle ORM
PostgreSQL
```

核心：

```text
Fastify
├─ OpenAI Gateway
├─ Auth
├─ Profiles
├─ Projects
├─ Memory
├─ Usage
└─ Providers
```

***

# 27. Database

推荐：

```text
PostgreSQL
+
Drizzle ORM
```

核心表：

```text
users
api_keys
providers
profiles
projects
skills
profile_skills
memories
request_usage
```

***

# 28. Memory Backend

MVP：

```text
Hermes
```

通过 Adapter：

```text
MemoryProvider
```

接入。

不要让 Web / API 直接依赖 Hermes 的内部结构。

***

# 29. Streaming

核心 API：

```text
POST /v1/chat/completions
```

使用：

```text
SSE
```

必须保证：

> Memory 检索不能明显拖慢首 Token。

理想流程：

```text
Auth
↓
Profile
↓
Memory Retrieval
↓
DeepSeek Stream
↓
Client
```

***

# 30. Monorepo

推荐：

```text
pnpm
+
Turborepo
```

目录：

```text
remember-api/
├─ apps/
│  ├─ web
│  └─ api
│
├─ packages/
│  ├─ db
│  ├─ core
│  ├─ memory
│  ├─ providers
│  ├─ ui
│  └─ shared
│
└─ docs/
```

***

# 31. 部署

推荐结构：

```text
Web
→ Vercel

API
→ VPS / Railway / Fly.io

PostgreSQL
→ Neon / Supabase / Railway

Hermes
→ Docker / VPS
```

如果个人 MVP：

最简单：

```text
一台 VPS
├─ Fastify
├─ Hermes
└─ PostgreSQL

Vercel
└─ Next.js
```

***

# 32. MVP 页面优先级

## P0

必须：

- Dashboard
- Profiles
- Projects
- Memories
- Usage
- API Keys
- Settings / Provider

***

## P1

后续：

- Skills
- Request Detail
- Advanced Memory Search
- Import
- Docs Center
- Onboarding 优化

***

# 33. MVP 功能验收

网站开发完成后应该能够完整执行：

```text
注册 / 登录
↓
添加 DeepSeek API Key
↓
创建 Project
↓
创建 Profile
↓
绑定 Project
↓
设置 Memory Budget
↓
创建 remember-api API Key
↓
复制 Base URL / Model / API Key
↓
Claude Code 接入
↓
开始 Coding
↓
产生 Memory
↓
Dashboard 查看 Memory
↓
切 DeepSeek Harness
↓
继续使用相同记忆
```

***

# 34. 完成效果

最终打开 remember-api 后，用户看到的应该是类似：

```text
remember-api

Good evening.

Requests
1,284

Today's Cost
¥18.42

Cache Hit
92.8%

Memory Overhead
3.7%

────────────────────────────────

Usage

        ▁▂▃▅▄▆▇▅

────────────────────────────────

Active Profiles

zero-dev
DeepSeek · citizen-zero
Memory 1.2K

remember-dev
DeepSeek · remember-api
Memory 980

────────────────────────────────

Recent Memories

Decision
Use Fastify for remember-api

Status
Memory adapter implementation started

Preference
Prefer pnpm for TypeScript projects
```

整体体验应该让用户感觉：

> **这不是一个 AI 聊天网站。**

而是：

> **属于自己的 AI API 控制台。**

***

# 35. 核心完成效果

产品真正完成后，需要达到三个效果。

### 1. 接入简单

用户只需要：

```text
BASE_URL
API_KEY
MODEL
```

***

### 2. Memory 可见、可改、可控

用户能够明确知道：

```text
AI 记住了什么
为什么记住
属于哪个项目
占多少 Token
```

***

### 3. 跨 Harness 连续

最终 Demo：

```text
Claude Code
↓
开发 remember-api
↓
退出

DeepSeek Harness
↓
“继续刚才 remember-api 的开发”
```

新的 Harness 能够理解：

```text
当前架构
当前进度
之前决策
失败方案
下一步任务
```

而不需要重新扫描和解释整个项目。

这就是 remember-api 网站第一版真正需要做到的完成效果。
