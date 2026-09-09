# remember-api

**One API. Same memory. Any AI client.**

Stateful Personal AI API —— OpenAI 兼容的个人 AI 网关：一个 key 绑一个「个人 model（子 agent）」，model 间互相隔离、可调用共享（项目）记忆；让 DeepSeek Harness / 各类 OpenAI 兼容客户端共享同一份 Personal/Project Memory。单用户产品。

> ## ⚠️ 开发中：web 控制台 + 公共服务器
>
> **`apps/web`（Next.js 控制台 + Fumadocs 文档站）与 公共服务器（对外部署栈：docker compose + Dockerfile + runbook + mem0 记忆桥）正在开发，暂不进 GitHub 云端。**
>
> 本仓库（GitHub）当前只承载 **api 网关端** 与其支撑的 `packages/*` 源码 + 环境模板 —— 这是**有意为之**，规则写在 `.gitignore`（见下「仓库 git 范围」），本地开发/运行不受任何影响。正式对外部署就绪后，web 与部署栈会从同一规则里放回并随仓库发布。

---

## 仓库 git 范围（只推 api 端）

云端 = GitHub 远程 `qiao-coding/remember-api`。当前策略：**web 控制台与部署/服务栈不推云端，只推 api 端**。

| 状态 | 路径 | 说明 |
|---|---|---|
| ✅ 进云（api 端） | `apps/api/` | Fastify 网关（`/v1` + 可选 `/api`） |
| ✅ 进云 | `packages/*` | `db/core/memory/providers/shared`，api 的依赖 |
| ✅ 进云 | 根配置 | `package.json` / `pnpm-workspace.yaml` / `turbo.json` / `tsconfig.base.json` / `.env*.example` |
| ✅ 进云 | `docs/`、`scripts/{e2e,pg-test,security-smoke}.sh/.mjs`、`ARCHIVE.md`、根交付 md | 文档与冒烟脚本 |
| ⛔ 不进云（ignore + 已 untrack） | `apps/web/` | web 控制台 —— **开发中** |
| ⛔ 不进云（ignore + 已 untrack） | `Dockerfile` `docker-compose.yml` `.dockerignore` | 部署/服务栈 —— **公共服务器开发中** |
| ⛔ 不进云（ignore + 已 untrack） | `scripts/deploy/` `scripts/mem0-bridge/` | runbook + mem0 记忆桥 —— **开发中** |

被摘除的目录**本地源码完整保留**，只是从 git 索引去掉：下次 `git push` 后，云端历史会删除这些路径（可逆、仅影响他人 clone；本地无感知）。

### 恢复发布（web / 部署栈就绪时）

```bash
# 1) 放开 ignore：把 .gitignore 末尾「云端只推 api 端」块里对应行删掉
# 2) 重新追踪并提交
git add apps/web          # 或 git add Dockerfile docker-compose.yml .dockerignore scripts/deploy scripts/mem0-bridge
git commit -m "chore: 发布 web / 部署栈"
git push origin main
```

## Git 操作：日常只推 api 端

ignore 规则会自动拦下 web/server，无需每次手动挑文件：

```bash
git add -A                 # 只会上车未忽略的改动（api + packages + 文档…）
git status                 # 复查：不应出现 apps/web / Dockerfile / compose / scripts/deploy|mem0-bridge
git commit -m "<msg>"
git push origin main       # 推 GitHub 云端
```

校验云端范围（应为空）：

```bash
git ls-files | grep -E 'apps/web|docker-compose|scripts/(deploy|mem0-bridge)|^Dockerfile$' 
```

误把忽略文件 `git add -f` 进去后想撤回：

```bash
git restore --staged apps/web           # 移出暂存即可，不加 -f 加不回
```

## 快速跑通（本地，证明可用）

需要：Node ≥22 + pnpm、一个 PostgreSQL（本地或 Supabase 均可用）。下面以本地 PG 为例。

```bash
# 1) 建库 + auth.uid() stub（本地 PG 没有 Supabase auth schema，0001 迁移的 RLS 需要它；superuser 绕过 RLS）
#    psql: CREATE DATABASE remember_api;
psql -c "CREATE SCHEMA IF NOT EXISTS auth; \
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS \$\$ SELECT null::uuid \$\$;"

# 2) env：建 apps/api/.env（模型 key/base_url 走环境变量；SUPABASE_URL 留空 = 网关-only）
#    DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/remember_api
#    DEEPSEEK_API_KEY=sk-xxxx
#    DEEPSEEK_BASE_URL=https://api.deepseek.com
#    API_KEY_PEPPER=<openssl rand -hex 32>   ENCRYPTION_KEY=<openssl rand -hex 32>
pnpm install

# 3) 建表 + 种子（conversation_summaries 等新表由 db:migrate 一并建立）
MIGRATE_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/remember_api pnpm db:migrate
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/remember_api \
  SEED_USER_ID=usr_local_admin \
  SEED_USER_EMAIL=admin@remember.local \
  BOOTSTRAP_API_KEY=rma_local_demo \
  pnpm db:seed          # 输出会打印引导 key 明文：rma_local_demo

# 4) 起服务
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/remember_api \
  pnpm --filter @remember/api dev    # :4000
```

冒烟（证明可用）：

```bash
curl -s -H "Authorization: Bearer rma_local_demo" http://127.0.0.1:4000/v1/models
# {"object":"list","data":[{"id":"remember-dev","object":"model","owned_by":"deepseek"}]}

curl -s -H "Authorization: Bearer rma_local_demo" -H "Content-Type: application/json" \
  --data '{"model":"deepseek-chat","messages":[{"role":"user","content":"reply with: OK"}]}' \
  http://127.0.0.1:4000/v1/chat/completions
# 200，走真实 DeepSeek，usage 正常
```

## 记忆机制（Claude 式 read 侧：recall 工具 + recent 会话交接）

网关读侧把记忆从「被动检索背景」升级为「有注意力的双通道」：

- **recent（开场交接）**：每会话滚动摘要存 `conversation_summaries`（PK `user+profile`，双槽 prev/active）。换新会话时上一会话的收尾状态 seal 冻结进 prev，注入下个会话 system 的 `[Recent Threads]` —— 让 AI「记得接着上次聊」，提醒类指令在此呈现才执行。
- **history（按需检索）**：`recall_memories(query)` 声明为工具，由**网关内 agentic loop**（≤3 轮）执行——模型想查 → 网关自己搜 mem0/DB 回填工具结果继续，**客户端零感知**；上游不支持 tools 时自动去工具降级重发。

关键 env（`apps/api/.env`，均有默认值，可不动）：

```bash
RECALL_TOOLS=true                       # 工具型自主 recall 开关（"false" 关）
RECENT_MIN_TOKENS=1000                  # 会话累计达此 token 才产首个 recent 摘要
RECENT_GROWTH_TOKENS=800                # 距上次摘要再涨 ≥ 此值才刷新
RECENT_MAX_TRANSCRIPT_TOKENS=3000       # 喂给摘要 LLM 的转写窗口上限
RECENT_MAX_INJECT_TOKENS=300            # 注入 system 的 recent 文本预算
```

## OpenAI 兼容客户端接入

`/v1` 是 OpenAI 协议（`GET /v1/models` + `POST /v1/chat/completions`）。任意支持自定义 base_url 的 OpenAI 兼容客户端：

```
base_url = http://<host>:4000/v1
api_key  = <绑定的 rma_ key>      # 一个 key 绑一个个人 model，隔离 + 共享项目记忆
```

> Claude Code 走 Anthropic 协议，需在其前置一层 Anthropic→OpenAI 翻译（如 LiteLLM），不属本网关范畴。

## 模型 key / base_url 走环境变量

- **DeepSeek（网关默认）**：`DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL`。运行时按 profile 的 provider 解析，deepseek 无 DB 加密行时回退到 env。
- **其它 provider / 完整形态**：web 控制台把 provider key/base_url 写入 `provider_configs`（AES-256-GCM，`ENCRYPTION_KEY`）。web 发布前，完整形态依赖的云 auth 管理仍在开发。

## 本地开发

```bash
pnpm install
pnpm dev              # turbo：api :4000（+ 本地未入云的 web :3000，若你在本地跑它）
pnpm typecheck
pnpm --filter @remember/api test   # vitest 单测
```

## 部署 / 公共服务器（开发中）

正式对外部署 = **docker compose（api + mem0 记忆桥）+ Supabase 云 DB/auth**，仍在开发，部署产物**不随本仓库进 GitHub**（见「仓库 git 范围」）。本地机器的部署物料完好，逐机步骤在本地 `scripts/deploy/runbook.md`；待公共服务器就绪后，这部分会随仓库一并发布。
