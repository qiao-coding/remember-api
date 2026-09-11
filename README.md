# remember-api

**让每个人都拥有一个属于自己的个人 AI。**

remember-api 的核心不是一个独立的 agent 应用，而是 **个人 AI（Personal AI）**：一个长期存在、理解你、跟随你、由你控制的 AI 身份。它不是重新造一个聊天应用模式，而是把你的身份、偏好、项目记忆和模型配置放在一个 OpenAI-compatible API 后面，让你身边的任何不同的 AI 客户端都能连接到同一个属于你的个人 AI。

![remember-api overview](docs/assets/remember-api-overview.svg)

## 项目定位

**remember-api 是属于用户自己的 Personal AI Gateway。**

## 核心价值

remember-api 最重要的价值不是“多一个 API 代理”，而是：**让你拥有自己的个人 AI，并让这个个人 AI 的数据不再被某个厂商绑定，让个人数据变成不可替代的资产沉淀下来。**

你的偏好、项目背景、历史决策、长期任务状态，本质上都是独属于你个人的长期资产。它们不应该天然属于某个聊天产品、某个 IDE 插件、某个模型供应商，也不应该只能在一家生态里生效。remember-api 把这些数据放回用户自己可控的 Personal AI 层里，让它们可以被查看、修正、删除、迁移，并按你的授权提供给不同工具使用。

这带来几个直接优势：

- **个人 AI 私有化**：你拥有的不是某个厂商账号里的临时助手，而是自己的个人 AI。
- **数据私人化**：个人偏好、项目记忆和长期上下文先属于你，再成为个人 AI 的能力。
- **不被厂商锁定**：今天用 DeepSeek，明天用 GPT，后天用 Claude，记忆不跟着厂商消失。
- **不被客户端锁定**：今天在 Codex 里工作，明天换 Cursor 或其他工具，项目上下文依然能延续。
- **不重复训练 AI**：你不必在每个新工具里重新解释“我是谁、我怎么工作、这个项目到哪了”。
- **数据共享** ：你可以将自己的核心资产，通过云端调用分享给需要你的工作流技能的人

**只要世界上某个工具或应用可以连接 OpenAI-compatible AI，理论上就可以连接 remember-api；只要它能连接 remember-api，就可以使用你授权的同一份个人 AI 记忆和项目上下文。**

这意味着 remember-api 不依赖某一个客户端成为入口。任何支持填写 Base URL、API Key、Model 的应用，都可以变成你个人 AI 的一个前端。你的个人 AI 才是中心，工具只是入口。

## 市场痛点

AI 工具正在快速分裂。写代码可能用 Codex 和 Claude Code，IDE 里用 Cursor，日常问答用 ChatGPT 或 DeepSeek，资料整理又换成另一个客户端。每个产品都在建立自己的记忆、项目上下文和用户偏好，但这些数据通常彼此不通。

![AI memory islands](docs/assets/ai-memory-islands.svg)

对用户来说，这会变成几个很具体的问题：

- 换一个客户端，就要重新介绍自己。
- 换一个模型，就要重新解释项目。
- 换一个工作流，之前的决策和偏好又散在旧聊天记录里。
- 记忆越多越不透明，不知道它到底记了什么、花了多少 token、有没有过时。

今天的体验常常是这样：

```text
ChatGPT 中的我
≠
Claude 中的我
≠
Cursor 中的我
≠
Codex 中的我
```

一个工具知道你偏好 TypeScript，另一个工具知道项目用了 Fastify，第三个工具知道上次方案失败在哪里。但当你切换工具时，这些上下文很难自然延续。

更麻烦的是，用户真正沉淀下来的资产不是某一段聊天记录，而是长期使用 AI 形成的工作方式：

- 我是谁，我现在在做什么。
- 我偏好什么技术栈、表达方式和协作节奏。
- 某个项目为什么选择这套架构。
- 哪些方案试过但失败了。
- 哪些决定之后不要反复推翻。
- 上一次聊到哪里，还有什么没完成。

这些数据如果锁在某一家产品里，用户就会被客户端和模型生态反向绑定。模型越强，迁移成本反而越高：你沉淀得越多，越舍不得离开。真正应该沉淀的不是“某个平台里的你”，而是一个可以跨平台延续的个人 AI。

## 解决思路

remember-api 把 AI 的长期上下文从具体客户端里抽出来，变成用户自己可控的一层：

> **模型只是算力供应商。记忆、身份和长期上下文应该属于用户。**

![personal AI layer](docs/assets/personal-ai-layer.svg)

传统模式是：

```text
用户 -> 某个 AI 客户端 -> 该客户端自己的记忆 -> 该客户端绑定的模型
```

remember-api 的模式是：

```text
用户 -> 任意 OpenAI 兼容客户端 -> remember-api -> 任意底层模型
                                      |
                                      +-> 个人偏好
                                      +-> 项目记忆
                                      +-> 历史决策
                                      +-> Skills
                                      +-> 用量和成本
```

你首先调用的是“我的个人 AI”。remember-api 再根据当前 Profile、Project 和请求内容，把必要的记忆组织进模型上下文，并把回答后的重要信息继续沉淀下来。

换句话说，remember-api 让用户拥有一个独立于厂商和客户端的个人 AI 数据层。工具只是入口，模型只是引擎，真正持续存在的是你的个人 AI。

## 它能帮你做什么

![user benefits](docs/assets/user-benefits.svg)

### 1. 少重复解释自己

你不需要每次告诉 AI 自己是谁、喜欢什么风格、常用什么技术栈。偏好可以被长期保存，并在不同客户端里复用。

### 2. 少重复解释项目

项目架构、当前状态、关键决策、已知问题和失败尝试可以沉淀为 Project Memory。新的对话开始时，AI 不必重新读完所有历史，也能接上项目背景。

### 3. 让个人 AI 跨模型延续

今天使用 DeepSeek，明天换 GPT，后天换 Claude，底层模型可以变，但 Profile 指向的个人上下文仍然存在。你迁移的是算力，不是重新建立一个个人 AI。

### 4. 让个人数据不被厂商绑定

你的 AI 使用历史会越来越有价值：偏好、项目、习惯、经验、失败路径、长期目标都会沉淀下来。remember-api 的意义是把这些数据私人化，让它们成为个人 AI 的长期资产，而不是被锁进某个厂商账号或某个客户端数据库。

### 5. 让记忆可看、可改、可控

记忆系统最怕“它好像记了什么，但我不知道”。remember-api 的控制台方向是让用户能查看、搜索、固定、修改、删除记忆，并观察 memory tokens 和成本开销。

### 6. 用现有客户端直接接入

remember-api 保持 OpenAI 协议兼容。很多工具不需要开发插件，只要能填写 Base URL、API Key 和 Model 名，就能连接到你的个人 AI，并使用同一套记忆。

## 核心能力

### 1. 换工具，不换记忆

只要客户端支持 OpenAI 协议，你就可以把它指向 remember-api：

```text
base_url = http://<host>:4000/v1
api_key  = <rma_...>
model    = <你的 Profile 名>
```

客户端以为自己在调用一个普通 model。remember-api 内部会把这个 model 名解析成一个 Profile。Profile 本质上就是一个个人 AI 的身份和工作模式：它绑定 Provider、Project、Memory Budget、偏好和相关记忆。

### 2. Project Memory 不乱串

个人偏好可以长期复用，但项目上下文必须有边界。remember-api 用 Project 隔离不同主题，避免把 A 项目的架构决策带进 B 项目。

适合沉淀的记忆包括：

- 你明确要求 AI 记住的偏好。
- 项目采用过的架构和技术决策。
- 当前进度、待办、已完成状态。
- 失败尝试和不要再重复的方案。
- 长对话的阶段性摘要和交接信息。

### 3. 记忆成本可观察

记忆不是免费的。把上下文注入 prompt 会消耗 token，所以 remember-api 不追求“无限塞入”，而是通过 Memory Budget 控制单次请求可注入的记忆量，并在 Usage 里记录 memory tokens、skill tokens、延迟和估算成本。

### 4. 保持 OpenAI 兼容

remember-api 不要求客户端理解新的记忆协议。它提供标准的：

- `GET /v1/models`
- `POST /v1/chat/completions`

这意味着很多现有工具只需要改 Base URL、API Key 和 Model 名，就能接入一个带长期记忆的个人 AI。只要一个应用能连接 OpenAI-compatible AI，它就可以把 remember-api 当成自己的 AI 后端；只要它连接到 remember-api，它拿到的就不是一台陌生模型，而是带着你授权上下文的 Personal AI。

## 工作方式

![profile as model](docs/assets/profile-as-model.svg)

一次请求进入 remember-api 后，大致会经历这些步骤：

1. 根据 API Key 找到绑定的个人 Profile。
2. 检查请求的 `model` 是否就是这个 key 允许访问的 Profile。
3. 读取 Profile 的 system prompt、底层 provider 和真实模型名。
4. 根据最后一条用户消息检索相关记忆，并按 Memory Budget 裁剪。
5. 把稳定偏好、会话交接摘要和记忆召回提示放入 system 前缀。
6. 把本轮相关记忆折叠进最后一条 user 消息，减少 prompt cache 抖动。
7. 调用底层模型，返回 OpenAI 兼容响应或 SSE 流。
8. 异步沉淀新的长期记忆、长对话归档和 recent thread 摘要。

如果启用了工具型 recall，模型还可以在网关内部通过 `recall_memories` 主动查询记忆。上游模型不支持 tools 时，会自动降级为普通聊天，不让记忆系统拖垮请求。

## 控制台想解决的问题

![memory console](docs/assets/memory-console.svg)

remember-api 的 Web 控制台不是另一个聊天页面。它更像是个人 AI 的控制面板：

- **Profiles**：把一种工作方式伪装成客户端可选的 model。
- **Projects**：管理项目摘要、架构、状态、决策和已知问题。
- **Memories**：查看、搜索、编辑、固定或删除 AI 记住的内容。
- **Providers**：配置上游模型服务；Provider 层支持任意 OpenAI 兼容厂商，默认示例是 DeepSeek。
- **Keys**：创建只绑定一个 Profile 的 API Key，减少跨个人 model 串用。
- **Usage**：观察请求次数、token、memory overhead、成本和延迟。
- **Skills**：保存可复用的行为说明，并按 Profile 绑定。

> 当前 `apps/web` 控制台和公共服务器部署栈仍在本地开发中，GitHub 云端策略以 API 端为主。API、packages、文档和冒烟脚本是当前主要可同步范围。

## 适合谁

remember-api 更适合第一批高频 AI 用户，而不是“偶尔聊天”的普通用户。

- **独立开发者**：同时使用 Codex、Claude Code、Cursor、DeepSeek 等工具，不想反复解释项目背景。
- **AI 编程重度用户**：希望 AI 记住架构决策、失败尝试、代码风格和当前进度。
- **Agent 开发者**：需要一个可控的 Profile、Memory、Project 和 Provider 基础层。
- **个人知识工作者**：希望不同写作、研究、计划工具共享同一套个人偏好和长期任务状态。

## 一个真实使用场景

你告诉 AI：

```text
我主要写 TypeScript 和 React，喜欢直接清晰的实现，不喜欢为了抽象而抽象。
remember-api 这个项目用 Fastify 做 OpenAI-compatible gateway。
上次试过把 project 实体整段注入 prompt，后来改成只把记忆作为事实源。
```

这些信息会逐渐沉淀成 preference、decision、status、issue 等记忆。之后你换到另一个 OpenAI 兼容客户端，只要仍然使用同一个 remember-api Profile，它就能继续知道你的偏好和项目背景。

你不再是在每个工具里从零开始训练一个临时助手，而是在调用同一个属于你的 Personal AI。

## 快速跑通

需要：

- Node.js >= 22
- pnpm
- PostgreSQL，本地或 Supabase 均可
- 一个上游模型 API Key（任意 OpenAI 兼容厂商，默认示例是 DeepSeek）

不想克隆仓库的话，两条命令装完（建库、迁移、录 Key、起网关全在向导里）：

```bash
npx remember-api init   # 向导：建库 → 选厂商与模型 → 录 Key → 自检
npx remember-api up     # 起网关，打印 Base URL / API Key / Model 三件套
```

录一次 Key 之后，换模型只切一行且不用重启网关：`npx remember-api model use deepseek/deepseek-v4-pro`。

下面的手动路径以本地 PostgreSQL 为例。

```bash
# 1. 创建数据库
psql -c "CREATE DATABASE remember_api;"

# 2. 本地 PostgreSQL 没有 Supabase auth schema，迁移前补一个 auth.uid() stub
psql -d remember_api -c "CREATE SCHEMA IF NOT EXISTS auth;"
psql -d remember_api -c "CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT null::uuid';"

# 3. 安装依赖
pnpm install

# 4. 配置 apps/api/.env
# DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/remember_api
# UPSTREAM_API_KEY=sk-xxxx
# UPSTREAM_BASE_URL=   # 留空 = 按 Profile 的 provider 用各家默认端点
# API_KEY_PEPPER=<openssl rand -hex 32>
# ENCRYPTION_KEY=<openssl rand -hex 32>

# 5. 建表
MIGRATE_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/remember_api pnpm db:migrate

# 6. 写入本地 demo 用户、Profile 和 API Key
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/remember_api \
  SEED_USER_ID=usr_local_admin \
  SEED_USER_EMAIL=admin@remember.local \
  BOOTSTRAP_API_KEY=rma_local_demo \
  pnpm db:seed

# 7. 启动 API
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/remember_api \
  pnpm --filter @remember/api dev
```

服务默认运行在 `http://127.0.0.1:4000`。

## 验证 OpenAI 兼容接口

```bash
curl -s \
  -H "Authorization: Bearer rma_local_demo" \
  http://127.0.0.1:4000/v1/models
```

你会看到当前 key 绑定的 Profile，例如：

```json
{
  "object": "list",
  "data": [
    {
      "id": "remember-dev",
      "object": "model",
      "owned_by": "deepseek"
    }
  ]
}
```

再发起一次聊天：

```bash
curl -s \
  -H "Authorization: Bearer rma_local_demo" \
  -H "Content-Type: application/json" \
  --data '{"model":"remember-dev","messages":[{"role":"user","content":"reply with: OK"}]}' \
  http://127.0.0.1:4000/v1/chat/completions
```

## 客户端怎么填

在任意 OpenAI 兼容客户端里填写：

```text
Base URL: http://127.0.0.1:4000/v1
API Key:  rma_local_demo
Model:    remember-dev
```

注意：remember-api 目前要求一个 API Key 绑定一个个人 Profile。即使同一用户有多个 Profile，某个 key 也只能访问它绑定的那个 Profile，避免客户端误请求其他个人 model。

## 重要环境变量

| 变量                                   | 说明                                                                                                 |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                       | API 运行时数据库连接                                                                                       |
| `MIGRATE_DATABASE_URL`               | 数据库迁移连接，常用于本地或 CI                                                                                  |
| `UPSTREAM_API_KEY`                   | **回退**上游 key：用户在控制台或 `npx remember-api model add` 录过 `provider_configs` 的厂商走库里那把加密 Key，这里可以留空 |
| `UPSTREAM_BASE_URL`                  | 同上，只对回退路径生效。留空则按 Profile 的 `provider` 用各家默认端点；填了则走回退的 Profile 都走这一个地址（**不会**覆盖 provider_configs 里那行的 baseUrl） |
| `SEED_PROVIDER` / `SEED_MODEL`       | `db:seed` 写入的样例 Profile 走哪家哪个模型，默认 `deepseek` / `deepseek-chat`                                    |
| `ARCHIVE_PROVIDER` / `ARCHIVE_MODEL` | 归档与 recent 摘要的提炼模型，默认同网关主路径；换厂商需成对设置                                                               |
| `SUPABASE_URL`                       | 留空时为 gateway-only 模式，仅挂 `/v1` 和 `/health`                                                          |
| `SUPABASE_SERVICE_ROLE_KEY`          | 运行时未读取（`/api` 的 JWT 验签走 `jose`），可留空                                                                  |
| `MEM0_BASE_URL`                      | 可选，配置后走 Mem0 bridge，否则使用 DB memory provider                                                        |
| `MEM0_API_KEY`                       | Mem0 bridge 鉴权 key                                                                                 |
| `API_KEY_PEPPER`                     | API Key hash pepper，生产环境必须修改                                                                       |
| `ENCRYPTION_KEY`                     | Provider key 加密密钥，生产环境必须修改                                                                         |
| `RECALL_TOOLS`                       | 是否启用网关内自主 recall，默认 `true`                                                                         |
| `RECENT_MIN_TOKENS`                  | 会话累计到多少 token 后生成 recent 摘要                                                                        |
| `RECENT_MAX_INJECT_TOKENS`           | recent 交接摘要注入预算                                                                                    |

## 本地开发命令

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm --filter @remember/api test
pnpm build
```

常用脚本：

```bash
pnpm db:migrate
pnpm db:seed
```

## 仓库结构

```text
apps/api               Fastify API，提供 /v1 OpenAI-compatible gateway 和 /api 管理接口
packages/core          上下文构建、token 估算、Memory Budget
packages/db            Drizzle schema、迁移、seed
packages/memory        DB / Mem0 memory provider 抽象
packages/providers     上游模型 provider 适配
packages/shared        OpenAI 类型、key/id 常量与共享工具
docs                   产品定位、接口契约、开发计划和 UX 规格
scripts                冒烟、e2e、PostgreSQL 测试脚本
```

## 当前状态

已具备：

- OpenAI-compatible `/v1/models` 和 `/v1/chat/completions`。
- API Key 绑定单个 Profile 的隔离模型。
- Provider 层支持任意 OpenAI 兼容厂商（`deepseek` / `openai` / `anthropic` / `openrouter` / `custom`），`provider` 决定路由、`UPSTREAM_*` 提供凭据。
- DB memory provider，支持可选 Mem0 bridge。
- preference、decision、status、task、issue、history 等记忆类型。
- Memory Budget 和 Usage 记录。
- recent thread 摘要、长对话归档、异步记忆写入。
- `/api` 管理路由：profiles、projects、memories、skills、providers、keys、usage。

仍在开发：

- `apps/web` 控制台的完整发布。
- 公共服务器部署栈。
- 每个 Profile 独立的上游凭据（目前凭据仍是网关级 `UPSTREAM_*`，所有 Profile 共用一份）。
- 更成熟的记忆治理：合并、过期、冲突处理、导出和迁移。

## 项目愿景

remember-api 的目标不是重新制造一个聊天应用，也不是只做一个向量检索服务。它想成为个人 AI 的可迁移状态层：

> **Your AI. Your Memory. Any Model.**

未来你可以自由选择客户端和模型，但仍然保留一个长期存在、可观察、可编辑、可迁移的 Personal AI。你的个人数据不被厂商绑定，你的 AI 记忆不被某个工具锁死；任何能连接 OpenAI-compatible AI 的应用，都可以成为你个人 AI 的入口。
