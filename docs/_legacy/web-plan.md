# Web 端功能计划

Web 端定位是 Personal AI API 的控制台，负责看、改、配、统计。它不提供聊天主界面，也不实现 Agent 执行循环。

## 信息架构

最终侧边栏：

- Dashboard
- Profiles
- Projects
- Memories
- Skills
- Usage
- API Keys
- Providers
- Docs
- Settings

## Cycle W1: 应用外壳与导航

目标：后台看起来像一个稳定的开发者控制台。

已完成：

- 固定侧边栏
- 顶部状态栏
- 响应式移动端导航抽屉
- 统一内容宽度
- 浅色 / 深色模式基础样式
- `/docs` 页面入口

继续补强：

- 顶部全局搜索实际接入 Profiles / Projects / Memories
- 用户菜单展示账号与退出
- 页面级 loading / error empty state 统一

验收：

- 桌面端 1024px 以上无需横向滚动
- 移动端能打开导航并查看核心表格
- 深色模式文字和边框可读

## Cycle W2: Dashboard

目标：打开后台后立刻知道 API 使用状态。

功能：

- 请求数
- 输入 / 输出 tokens
- cached tokens
- memory tokens
- skill tokens
- 估算成本
- cache hit
- memory overhead
- 平均延迟
- 最近请求
- 活跃 Profiles
- 最近 Memories

验收：

- 无数据时页面不空白
- 有 usage 数据时统计值和 `/api/usage/summary` 一致
- 成本单位统一为人民币 `¥`

## Cycle W3: Profiles

目标：用户可以配置客户端看到的 `model`。

功能：

- Profile CRUD
- Provider 选择
- Base Model 设置
- Project 绑定
- Memory 开关
- Memory Budget 设置
- System Prompt 编辑
- Skill 多选绑定
- Connection 信息展示

验收：

- 创建 Profile 后 `/v1/models` 立即可见
- 修改 Project 绑定后下一次请求使用新 Project Context
- Skill 不再要求用户手填 ID

## Cycle W4: Projects

目标：项目上下文可人工维护，保证记忆可纠错。

功能：

- Project CRUD
- Summary / Architecture / Status 编辑
- Decisions / Known Issues 列表编辑
- Project Memory tab
- Project Usage tab

验收：

- Project 删除后 Profile 自动解除绑定或明确提示影响
- 不同 Project 之间 Memory 不互相污染

## Cycle W5: Memories

目标：Memory 可见、可改、可控。

功能：

- 搜索
- 类型过滤
- Project 过滤
- Pinned 过滤
- 创建 Memory
- 编辑 Memory
- 删除 Memory
- Pin / Unpin
- 重要度调整
- 来源与时间展示

验收：

- 用户可以修正自动写入的错误记忆
- 全局记忆和项目记忆在 UI 上清晰区分
- 搜索结果展示 relevance

## Cycle W6: API Keys / Providers / Skills

目标：完成真实接入所需配置。

API Keys：

- 创建 `rma_` key
- 只显示一次明文
- 禁用 / 启用 / 删除
- last used 时间

Providers：

- DeepSeek 配置
- Base URL
- Default Model
- API Key 加密保存
- 连接测试

Skills：

- 创建 / 编辑 / 删除
- token 估算
- Markdown 导入
- Used by Profiles 展示

验收：

- 新建 Key 可直接调用 `/v1/chat/completions`
- Provider Key 不在任何列表接口返回
- Skill 修改后下一次 Profile 请求生效
