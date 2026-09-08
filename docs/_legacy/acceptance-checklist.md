# 验收清单

## Product

- [ ] 用户能创建 Project、Profile、Provider、API Key
- [ ] OpenAI-compatible 客户端能直接调用
- [ ] 至少两个 Harness 能共享同一 Profile 与 Memory
- [ ] 用户能看到 Memory 内容、来源、类型、重要度和所属 Project
- [ ] 用户能看到 memory overhead 与 estimated cost

## API Server

- [ ] `GET /health`
- [ ] `GET /v1/models`
- [ ] `POST /v1/chat/completions`
- [ ] streaming SSE
- [ ] OpenAI-compatible error
- [ ] API Key hash 校验
- [ ] Supabase JWT 管理端鉴权
- [ ] Profile resolver
- [ ] Project resolver
- [ ] Memory retrieval
- [ ] Memory budget
- [ ] Context builder
- [ ] DeepSeek Provider
- [ ] MockProvider fallback
- [ ] Usage tracking
- [ ] Memory write
- [ ] Tenant isolation

## Web

- [ ] Login
- [ ] App shell
- [ ] Dashboard
- [ ] Profiles CRUD
- [ ] Projects CRUD
- [ ] Memories list/search/edit/delete/pin
- [ ] Skills CRUD
- [ ] Usage summary/charts/recent requests
- [ ] API Keys create/disable/delete
- [ ] Providers create/update/delete
- [ ] Docs quick start
- [ ] Mobile basic viewing
- [ ] Dark mode readable

## Security

- [ ] 不返回 API Key hash
- [ ] Provider Key 不通过列表接口返回
- [ ] A 用户不能访问 B 用户资源
- [ ] 管理 API 拒绝 rma key
- [ ] `/v1` API 拒绝 Supabase JWT
- [ ] 生产环境不使用默认 `API_KEY_PEPPER`
- [ ] 生产环境不使用默认 `ENCRYPTION_KEY`
- [ ] CORS 限定生产域名

## Observability

- [ ] 每次成功请求记录 latency
- [ ] 每次成功请求记录 input/output/cached tokens
- [ ] 每次成功请求记录 memory/skill tokens
- [ ] Dashboard 展示 memory overhead
- [ ] Usage 页支持 1 / 7 / 30 天窗口

## Demo

- [ ] 创建 `remember-dev` Profile
- [ ] 创建 `remember-api` Project
- [ ] 创建 `rma_` API Key
- [ ] Harness A 调用并产生偏好/决策/状态记忆
- [ ] Harness B 使用同一配置继续任务
- [ ] Harness B 能复述项目状态和下一步
