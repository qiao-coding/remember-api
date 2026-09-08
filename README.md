# remember-api

**One API. Same memory. Any AI client.**

Stateful Personal AI API —— OpenAI 兼容的个人 AI 网关：一个 key 绑一个「个人 model（子 agent）」，model 间互相隔离、可调用共享（项目）记忆；让 DeepSeek Harness / 各类 OpenAI 兼容客户端共享同一份 Personal/Project Memory。单用户产品。

## 架构：auth 模块与 api 网关解耦

| 形态 | `SUPABASE_URL` | 暴露路由 | 说明 |
|---|---|---|---|
| **网关-only**（最小、可独立部署） | **留空** | `/v1`（OpenAI）+ `/health` | 不依赖任何登录/控制台/auth 云。DB + 模型 env 即可跑通，**先证明可用性走这条** |
| **完整形态** | 填 `<ref>` | + `/api` 管理后台 | Supabase Auth JWT 验签；配合 `apps/web` 控制台管理 keys/profiles/memories |

- `/api` 管理路由**仅当 `SUPABASE_URL` 配置才挂载**（`apps/api/src/app.ts`）；`/v1` 网关永远可用。
- 模型 key/base_url 走**环境变量**，api 网关部署不绑定 auth。

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

# 3) 建表 + 种子（SEED_USER_ID：本地可用任意唯一 id；完整形态用 Supabase auth uid）
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

## Docker 正式部署（海外 VPS / Supabase 云）

仓库根自带完整交付物：

| 文件 | 作用 |
|---|---|
| `Dockerfile` | api 生产镜像（builder 全量构建 → `pnpm deploy` 薄 runtime） |
| `docker-compose.yml` | `api:4000` + `mem0-bridge:8001`（内网）+ `db-init`（`--profile init` 一次性 migrate+seed） |
| `.env.production.example` | 生产环境变量模板（→ `.env.production`，含密钥勿提交） |
| `scripts/mem0-bridge/download-model.sh` | 预置 embedding 模型入卷（海外 `export HF_ENDPOINT=https://huggingface.co`） |
| `scripts/deploy/runbook.md` | **逐机部署 runbook**（上传 → build → db-init → 起服务 → 冒烟 → 运维） |

两步走：

```bash
cp .env.production.example .env.production   # 填 DATABASE_URL/DEEPSEEK_API_KEY/密钥；SUPABASE_URL 留空即网关-only
docker compose --profile init run --rm db-init   # 首次建表 + 种子
docker compose up -d                             # api + mem0-bridge
curl -s -H "Authorization: Bearer $BOOTSTRAP_API_KEY" http://<HOST>:4000/v1/models
```

完整逐机步骤（Supabase CA 导出、放行端口、mem0 预下载、运维速查）见 [`scripts/deploy/runbook.md`](scripts/deploy/runbook.md)。

## 模型 key / base_url 走环境变量

- **DeepSeek（网关默认）**：`DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL`。运行时按 profile 的 provider 解析，deepseek 无 DB 加密行时回退到 env（见 `apps/api/src/services/chat.ts`）。
- **其它 provider / 完整形态**：web 控制台把 provider key/base_url 写入 `provider_configs`（AES-256-GCM，`ENCRYPTION_KEY`）。

## OpenAI 兼容客户端接入

`/v1` 是 OpenAI 协议（`GET /v1/models` + `POST /v1/chat/completions`）。任意支持自定义 base_url 的 OpenAI 兼容客户端：

```
base_url = http://<host>:4000/v1
api_key  = <绑定的 rma_ key>      # 一个 key 绑一个个人 model，隔离 + 共享项目记忆
```

> Claude Code 走 Anthropic 协议，需在其前置一层 Anthropic→OpenAI 翻译（如 LiteLLM），不属本网关范畴。

## 仓库结构

```
apps/api        Fastify :4000 —— /v1 网关 + /api 管理（可选挂载）
apps/web        Next.js 15 控制台 + Fumadocs 文档站（:3000）
packages/db     Drizzle schema / migrate / seed
packages/core|memory|providers|shared
scripts/deploy  runbook；scripts/mem0-bridge  记忆桥
```

## 本地开发

```bash
pnpm install
pnpm dev              # turbo：api :4000 + web :3000
pnpm typecheck
pnpm --filter @remember/api test   # vitest 单测
```
