# remember-api docs

> One API. Same memory. Any AI client.

本目录按 Loquar 项目的需求组织方式重整：先锁产品方向，再定义 V1 范围，然后分别给 Web 体验、Server 规格、开发交接、启动任务和验证记录留出独立文档。每份文档都应该能让下一位开发者直接判断：什么必须保留，什么本阶段要做，什么不能提前做。

## Source of truth order

按这个顺序阅读，避免把后续功能误当成本周期任务：

1. [Production Direction](./PRODUCT-DIRECTION.md)
2. [V1 — Stateful API MVP](./V1-STATEFUL-API.md)
3. [Web Console UX](./WEB-CONSOLE-UX.md)
4. [Server Gateway Spec](./SERVER-GATEWAY-SPEC.md)
5. [Claude Code Handoff](./CLAUDE_CODE_HANDOFF_REMEMBER_API.md)
6. [Claude Code Kickoff](./CLAUDE_CODE_KICKOFF_MVP.md)
7. [Validation Notes](./VALIDATION-NOTES.md)

## Supporting plans

这些文档保留为执行清单和快速参考：

- [Quick Start](./quick-start.md)
- [Web 端功能计划](./web-plan.md)
- [API Server 端功能计划](./api-server-plan.md)
- [任务周期与里程碑](./delivery-cycles.md)
- [验收清单](./acceptance-checklist.md)

## Current implementation baseline

当前仓库已经具备 MVP 骨架：

| Layer | Current state |
|---|---|
| API | Fastify `/v1/models`、`/v1/chat/completions`、stream / non-stream |
| Auth | `/v1` 使用 remember API Key，`/api` 使用 Supabase JWT |
| Context | Profile、Project、Preferences、Memory、Skills 注入 |
| Memory | DB fallback + Mem0 bridge adapter |
| Provider | DeepSeek Provider + Mock fallback |
| Usage | request usage、token breakdown、cost estimate |
| Web | Dashboard、Profiles、Projects、Memories、Skills、Usage、Keys、Providers、Docs、Settings |

## Non-negotiable product invariant

Harness 执行任务，remember-api 保存状态。Claude Code、Codex、Cursor、DeepSeek Harness 可以改变；用户的 Profile、Project Memory、Preferences、Skills 和 Usage history 必须留在 remember-api 里。

remember-api 不应演化成第二层 autonomous agent。它是一个带个人上下文的 OpenAI-compatible API。
