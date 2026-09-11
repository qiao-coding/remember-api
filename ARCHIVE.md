# remember-api — 重定位（ACTIVE · 2026-09-08 修正）

**状态：网关骨架复活演进；停的只有自研记忆检索层。** 下文「归档实证」保留为历史证据；本文件同时记录修正后的产品意图与核实结论。

## 产品意图（用户澄清，2026-09-08）
以「**个人 model(子agent)**」为隔离单元的 OpenAI 兼容网关，不是"一 key 全通"的普通转发：
- key 可**自主创建/自定义**（用户自供 `sk-123456` 或服务端 mint 均可）；
- 用户新建多个 **个人 model**，model 间**互相隔离**（A 的 key 调不到 B）；
- 每个 model 一个**独立 key**（key→model 绑定，key 即身份与权限边界）；
- 作用域如**项目隔离**的入口；
- model **内部可调用公共记忆**（该用户共享的项目/用户记忆桶）；
- **一个个人 model = 一个子 agent**（persona/systemPrompt/记忆开关等）。

## 与 Hermes 的边界（修正后）
- 收敛方向不撤，但范围缩小：Hermes 承担「agent 本身」的角色（推理/内置记忆/MEMORY.md/skills），见 [[project-hermes-agent-setup]]。
- **Hermes 替代不了本网关**：`hermes proxy` 上游写死 nous/xai（OAuth），无 key→model 隔离、桥不了 API-key 上游（源码核实，见下）。对外做"外部客户端 → 个人子 agent + key 隔离 + 共享记忆"的入口，由本仓库继续承担。
- 该停的 = **自研记忆检索层**（DbMemoryProvider 空白分词 ILIKE 中文召回弱），属"自造轮子弱于现成"教训——勿在记忆检索上重投，聚焦网关隔离语义。

## 待做（key→model 隔离改造，未开始）
现状 `api_keys` 为 **user 级**（schema：`apiKeys.userId`，一条 key 认证整个用户）→ 与"每 model 独立 key + 隔离"不符。改造点：schema(key scope)+发钥路由(可自供 secret)+api-key-auth 鉴权+/v1 路由(按 key 限 profile/project)+web UI。详见仓库内方案文档（若已产出）。

## 被 Hermes 取代的能力
| remember-api（本仓库自研） | Hermes Agent（现成） |
|---|---|
| `DbMemoryProvider`（关键词 ILIKE 检索） | 内置 MEMORY.md/USER.md + 外部 provider 插件（mem0 / honcho / retaindb / hindsight / …）+ memory-graph / curator / learning / journey |
| `memory-write.ts`（正则启发式提炼） | curator / learning 自动提炼 |
| profiles.skillIds / systemPrompt | `hermes skills` / bundles / USER.md |
| 自研 `/v1` OpenAI 兼容网关（rma_ key） | ⚠️ **无直接替代**。`hermes proxy` 上游写死 nous(Nous Portal)/xai(OAuth)，无 API-key 适配器，桥不了 DeepSeek。对外工具要 OpenAI 兼容 → DeepSeek 原生 `api.deepseek.com/v1` 即是，无需网关层 |
| 自托管 mem0 桥（fastembed + qdrant） | mem0 是 Hermes 的 memory provider 插件之一 |

## 归档实证（2026-09-08 双沙箱实测）
- 本地 PG + 真 DeepSeek 下，两个隔离工作台（不同 profile/key、同 project）冷启动共享记忆**全链路通过** ✅ —— 作为「能力验证」有效。
- 同时暴露自研记忆层弱点：`DbMemoryProvider` 按**空白分词 ILIKE**，纯中文无空格 = 单 token，**中文自然语义召回基本失效**（跨冷会话须共享 ASCII token 才能命中）。属典型的「自造轮子弱于现成实现」。

## Hermes 侧核实（2026-09-08，避免重做考古）
- `hermes proxy` 的 inbound 上游适配器在源码 `hermes_cli/proxy/adapters/ADAPTERS` 写死 **nous_portal + xai**（均为 OAuth，需登录外部账号），无任意 OpenAI 兼容 base_url/API-key 适配器。**不能**当 remember-api `/v1` 的 DeepSeek 网关用。
- `hermes egress …`（proxy_cli.py / iron-proxy）= Docker 沙箱的 egress 凭据隔离，是另一回事，也非对外网关。`hermes gateway` = 消息平台网关（Telegram 等）。
- `hermes memory` 外置 provider 现状（插件 + config_defaults env 段核实）：
  - **holographic**（`hermes-memory-store`）= 本地 SQLite 事实库，无 embedder/无网络/无 API key，零 infra 可用 ✅
  - mem0 OSS 自托管需 **Ollama**(LLM+embedder 拉模型) 或 OpenAI embed key + qdrant/pgvector —— 国内/网络重；
  - OpenViking=火山引擎端/需自起服务；Honcho 自托管=docker 全家桶；hindsight/retaindb/supermemory=云端 API key（本网不可达）。
  - 内置 MEMORY.md/USER.md **始终激活**、零配置、本地共享同一 config home 的会话即共享。

## 演进说明（2026-09-08 起）
不再以"复活"表述——网关骨架已就地重定位为活跃项目（见顶部「产品意图」）。记忆检索层维持现状不重投；Hermes 单点仍只覆盖「agent 本身」。本文件前几版若与顶部矛盾，以顶部「产品意图 / 与 Hermes 的边界」为准。

## 环境备注（供日后参考）
- git 仓库 **0 commits**（从无提交历史）。
- Supabase（kervulaespadqdxzgflk）项目在 **us-east-1**，入口是 `aws-0-us-east-1.pooler.supabase.com`（5432 = session 池供 DDL，6543 = 事务池供运行时）。**直连域名 `db.<ref>.supabase.co` 不可用**：只解析出 IPv6、没有 A 记录，纯 IPv4 网络里 DNS 直接失败，迁移也走池化地址、只换端口。（2026-09-11 复测更正；此前记的「直连/pooler 全不可达」不准 —— 池化地址本身是通的。）
  仍有一处网络限制：本机到池化 **端口的出口被挡** —— TCP 能建连，TLS 握手收不到一个字节，跨区域 / 跨 IP / 容器内表现一致。所以云端 E2E 在这台机器上跑不完，换网络（境外主机或代理）即可。
- 本地 PG 17（postgres:postgres@127.0.0.1）可用作实验库，本地迁移需先建 `auth.uid()` stub。
