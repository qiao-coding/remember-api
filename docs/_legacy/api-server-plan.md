# API Server 端功能计划

API Server 是 remember-api 的核心。它对外表现为 OpenAI-compatible API，对内完成身份识别、Profile 解析、Project 隔离、Memory 检索、Context 构建、Provider 调用和 Usage 记录。

## Cycle A1: OpenAI-compatible Gateway

已完成：

- `GET /v1/models`
- `POST /v1/chat/completions`
- non-streaming response
- SSE streaming response
- OpenAI-compatible error shape
- Bearer API Key 鉴权
- `remember.project`
- `remember.memory`
- `remember.memoryBudget`

继续补强：

- 支持更完整的 OpenAI message content parts
- 支持 `stop`、`presence_penalty`、`frequency_penalty`
- Streaming 结束时稳定记录 usage
- 上游错误透传更细的 `code`

验收：

- Claude Code / Codex / Cursor 等客户端只需配置 Base URL、API Key、Model
- stream 与 non-stream 都返回 OpenAI-compatible 结构
- 未授权请求返回 401

## Cycle A2: Authentication 与 Tenant Isolation

已完成：

- `/v1` 使用 remember API Key
- `/api` 使用 Supabase JWT
- API Key 只存 hash
- Provider Key AES-256-GCM 加密
- Supabase RLS 作为纵深防御
- 管理 API 按 userId 过滤

继续补强：

- API Key rate limit
- API Key scope，例如 read/write/profile 限制
- Provider Key 连接测试
- CORS 生产域名白名单

验收：

- A 用户无法读取、修改、删除 B 用户的任何 Project/Profile/Memory/Key
- rma key 不能访问管理 API
- Supabase JWT 不能访问 `/v1` 网关

## Cycle A3: Profile / Project Resolver

已完成：

- `model` 字段映射 Profile `name`
- Profile 指定 Provider 和 Base Model
- Profile 默认 Project
- 请求级 `remember.project` 覆盖
- Project 可用 id 或 name 解析

继续补强：

- `X-Remember-Project` header
- cwd / git remote 自动识别 Project
- Profile clone
- Profile connection preview

验收：

- `/v1/models` 只返回当前用户 Profile
- 请求指定不存在 Project 时返回明确错误
- Profile 默认参数可在模型调用时生效

## Cycle A4: Memory Retrieval 与 Context Builder

已完成：

- 全局偏好 pinned 检索
- 当前 Project 记忆检索
- 全局相关记忆检索
- Memory Budget 裁剪
- Profile / Preferences / Project / Relevant Memory / Skills 注入
- token breakdown

继续补强：

- 相关度 rerank
- Memory compression
- 长记忆截断
- Project summary 自动维护
- 冲突记忆检测

验收：

- 当前 Project 请求不会注入其他 Project 记忆
- Memory tokens 不超过请求预算
- System Context 中能区分 Profile、Preference、Project、Memory、Skills

## Cycle A5: Memory Write

已完成：

- 回合结束后异步写入
- 规则识别偏好、决策、状态、失败尝试
- 基础相似检索去重
- 每轮最多写入 2 条

继续补强：

- cheap model structured extraction
- create / update / merge 策略
- 用户可审计来源
- Git diff / commit 触发项目状态记忆
- Memory lifecycle: temporary / working / project / long-term / pinned

验收：

- 用户明确说“记住”时生成 preference
- 明确架构决策生成 decision
- 已完成事项生成 status
- 重复内容不会无限 append

## Cycle A6: Usage / Cost

已完成：

- request_usage 表
- input / output / cached / memory / skill tokens
- latency
- estimated cost
- summary / requests / breakdown API

继续补强：

- 日级趋势聚合
- 单次请求详情
- Memory ROI
- Provider 价格配置
- cache hit 与 memory overhead 图表

验收：

- 每次成功请求有 usage 记录
- Dashboard 能回答“记忆额外消耗多少 token”
- 成本单位和定价来源清楚

## Cycle A7: Deployment

功能：

- API Dockerfile
- Web Vercel 部署说明
- Supabase 迁移说明
- Mem0 bridge 部署说明
- 环境变量模板
- 健康检查

验收：

- 新机器按文档 30 分钟内能跑通
- `/health` 可用于部署探针
- 生产环境不使用默认 pepper / encryption key
