# 任务周期与里程碑

每个周期都以“可运行、可验证、可继续迭代”为标准。不要把大量功能堆到最后一次性验收。

## Cycle 0: Baseline

目标：确认当前仓库可运行。

任务：

- 安装依赖
- 配置 `.env`
- 运行数据库迁移
- seed 一个用户、Project、Profile、API Key
- 跑 `pnpm typecheck`
- 跑 `scripts/security-smoke.sh`

完成标准：

- Web 与 API 都能启动
- `/health` 正常
- `/v1/models` 返回当前用户 Profile

## Cycle 1: Gateway 可用

目标：AI 客户端可以把 remember-api 当作模型 API 使用。

任务：

- 完成 `/v1/chat/completions`
- 完成 streaming
- 完成 OpenAI-compatible error
- 接入 DeepSeek Provider
- 未配置 DeepSeek key 时 MockProvider 可跑通

完成标准：

- non-streaming 与 streaming 都可调用
- API Key 鉴权生效
- Profile `model` 映射正确

## Cycle 2: Context 可用

目标：每次请求都能带入正确的个人和项目上下文。

任务：

- Profile resolver
- Project resolver
- 全局偏好记忆
- Project 记忆
- Skills 注入
- Memory Budget
- token breakdown

完成标准：

- Project A 请求不包含 Project B 记忆
- Memory tokens 不超过预算
- Context Builder 输出结构稳定

## Cycle 3: Web 控制台可用

目标：用户不用改数据库，也能完成配置。

任务：

- Dashboard
- Profiles CRUD
- Projects CRUD
- Memories CRUD
- Skills CRUD
- API Keys CRUD
- Providers CRUD
- Docs 页面

完成标准：

- 用户能在 Web 端完成一次完整接入配置
- 创建 API Key 后可立即调用 `/v1`
- 页面无数据、加载、错误状态都可读

## Cycle 4: Memory 闭环

目标：请求后的重要状态能自动沉淀为记忆，并可人工纠错。

任务：

- 自动 Memory Write
- 相似记忆去重
- Memory 编辑
- Pin / Unpin
- Project 过滤
- source / updatedAt 展示

完成标准：

- 用户明确偏好被保存
- 架构决策被保存
- 重复记忆不会快速膨胀
- 用户能从 Web 修改错误记忆

## Cycle 5: Usage 与成本可观测

目标：用户知道每次请求花了什么。

任务：

- Usage summary
- Recent requests
- Profile breakdown
- Project breakdown
- Memory overhead
- cache hit
- estimated cost

完成标准：

- 每次请求都有 usage
- Dashboard 和 Usage 页数字一致
- Memory overhead 可按时间范围查看

## Cycle 6: Demo 与发布

目标：证明跨 Harness 共享上下文成立。

任务：

- Claude Code 接入说明
- Codex 接入说明
- DeepSeek Harness 接入说明
- e2e 脚本
- security smoke 脚本
- 部署文档

完成标准：

- Harness A 完成一段开发并写入记忆
- Harness B 使用同一 API Key 和 Profile 输入“继续刚才的工作”
- Harness B 能说出当前 Project、当前状态、关键决策和下一步
