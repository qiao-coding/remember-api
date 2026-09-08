# remember-api Web Console — UI/UX Direction

**Purpose.** Web 端是 Personal AI API 的控制台。它不聊天，不生成任务，不替代 Harness；它负责让用户配置 API、管理记忆、观察成本。

> **Core experience:** 用户能打开后台，创建 Project/Profile/API Key，确认记忆注入和用量统计，然后把三项连接信息复制到任意 OpenAI-compatible 客户端。

## Product principles

| Principle | Experience implication |
|---|---|
| **Control plane, not chat** | 第一屏是 Dashboard，不是聊天框。 |
| **Configuration is inspectable** | Profile、Project、Provider、Skill 都能看见当前状态。 |
| **Memory is editable** | 自动记忆不是神谕，用户必须能修正。 |
| **Cost is first-class** | Usage 页面和 Dashboard 都展示 memory overhead。 |
| **Developer dashboard tone** | 高信息密度、低装饰、清晰表格和表单。 |
| **Safe defaults** | 无数据、加载、错误、未连接 provider 都要有清楚状态。 |

## Information architecture

| Section | Job |
|---|---|
| Dashboard | 今天/近 7 天的请求、token、成本、延迟、活跃资源。 |
| Profiles | 管理客户端看到的 `model`。 |
| Projects | 管理项目摘要、架构、状态、决策和已知问题。 |
| Memories | 搜索、创建、编辑、删除、固定记忆。 |
| Skills | 创建 Markdown/TXT prompt fragments 并绑定 Profile。 |
| Usage | 查看请求明细、token breakdown、cache hit、memory overhead。 |
| API Keys | 创建、禁用、删除 `rma_` 调用密钥。 |
| Providers | 配置 DeepSeek key、base URL、default model。 |
| Docs | 展示本地接入方式和客户端配置。 |
| Settings | 账号和环境说明。 |

## Layout contract

| Region | Wide layout | Narrow layout |
|---|---|---|
| Sidebar | 固定左栏，显示全部主导航。 | 抽屉导航，通过顶部按钮打开。 |
| Top bar | 当前页面名、控制台副标题、搜索入口、用户信息。 | 当前页面名和导航按钮优先。 |
| Main content | 最大宽度约 1440px，表格横向滚动只限表格内部。 | 表单单列，表格保持可横向滚动。 |
| Cards | 只用于具体资源、表单、统计，不把整个页面套进大卡。 | 保持 8px 左右圆角和稳定间距。 |

## Primary flows

### Flow 1 — First working connection

| Step | User action | System response |
|---|---|---|
| 1 | 登录后台 | 进入 Dashboard。 |
| 2 | 配置 Provider | DeepSeek 显示 connected。 |
| 3 | 创建 Project | Project 有独立 `memoryNamespace`。 |
| 4 | 创建 Profile | Profile 绑定 provider/model/project/budget。 |
| 5 | 创建 API Key | 显示一次完整 `rma_` key。 |
| 6 | 打开 Docs | 看到 Base URL、API Key、Model。 |

### Flow 2 — Memory correction

| Step | User action | System response |
|---|---|---|
| 1 | 在 Memories 搜索关键词 | 返回相关记忆和 relevance。 |
| 2 | 按 Project 或 type 过滤 | 全局/项目记忆清楚区分。 |
| 3 | 编辑内容、类型、重要度或 Project | 下一次 Context 注入使用新版本。 |
| 4 | Pin 重要记忆 | Memory Budget 优先保留。 |

### Flow 3 — Cost inspection

| Step | User action | System response |
|---|---|---|
| 1 | 打开 Usage | 默认看 7 天摘要。 |
| 2 | 切换 1/7/30 天 | Summary 和图表刷新。 |
| 3 | 查看最近请求 | 看到 input/output/cached/memory/skill tokens。 |
| 4 | 比较 memory overhead | 判断记忆是否值得注入。 |

## Visual direction

remember-api 应该像开发者控制台，而不是 AI 营销站。

| Element | Treatment |
|---|---|
| Palette | neutral 黑白灰为主，少量蓝/绿/红/琥珀状态色。 |
| Typography | 紧凑、清晰，表格和 key 使用 monospace。 |
| Density | 一屏显示真实工作信息，避免大 hero 和装饰图。 |
| Motion | MVP 不需要动画，交互状态以 hover/focus/loading 为主。 |
| Dark mode | 跟随系统偏好，表格、输入框、卡片都必须可读。 |

## P0 web boundary

| Included | Deliberately deferred |
|---|---|
| 基础登录和路由保护 | 注册/onboarding wizard |
| CRUD 表格与表单 | 复杂可视化编辑器 |
| Memory 编辑/过滤/pin | Memory merge review workflow |
| Usage 汇总和最近请求 | 单次 request trace 详情页 |
| Provider 配置 | 多 provider 路由策略 |
| Docs quick start | 完整公开文档站 |

## Accessibility and resilient paths

所有主操作必须是按钮或表单控件，不依赖悬浮文本。表格在小屏允许横向滚动，不能让页面整体错位。API Key 明文只显示一次，复制按钮必须可键盘聚焦。Memory 的固定状态不能只靠图标表达，也要有文字。

## Demo acceptance checklist

评审者不读源码也应该能完成：登录、创建 Project、创建 Profile、创建 API Key、查看 Docs 连接信息、创建一条全局 Memory、创建一条项目 Memory、Pin 一条 Memory、查看 Usage 空状态或真实统计。桌面和移动宽度都不能出现互相覆盖的文字或不可操作的主按钮。
