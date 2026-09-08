# Quick Start

## 1. 环境要求

- Node.js 22+
- pnpm 11+
- PostgreSQL / Supabase PostgreSQL
- Supabase Auth
- DeepSeek API Key，可选；未配置时会使用 MockProvider 验证链路
- Mem0 bridge，可选；未配置时使用数据库表作为记忆后端

## 2. 安装依赖

```bash
pnpm install
```

## 3. 配置 API 环境变量

复制 `.env.example` 到 `apps/api/.env`，至少配置：

```bash
DATABASE_URL=
MIGRATE_DATABASE_URL=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
API_KEY_PEPPER=
ENCRYPTION_KEY=
DEEPSEEK_API_KEY=
PORT=4000
```

## 4. 配置 Web 环境变量

编辑 `apps/web/.env.local`：

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
API_URL=http://localhost:4000
```

## 5. 初始化数据库

```bash
pnpm db:migrate
```

如果需要样例数据：

```bash
SEED_USER_ID=<supabase-auth-uid> pnpm db:seed
```

## 6. 启动开发服务

```bash
pnpm dev
```

默认端口：

- Web: `http://localhost:3000`
- API: `http://localhost:4000`

## 7. OpenAI-compatible 客户端配置

```text
BASE_URL=http://localhost:4000/v1
API_KEY=rma_...
MODEL=remember-dev
```

## 8. 最小验证

```bash
curl http://localhost:4000/health
curl -H "Authorization: Bearer rma_bootstrap_local" http://localhost:4000/v1/models
```

完整链路验证使用：

```bash
bash scripts/e2e.sh
bash scripts/security-smoke.sh
```
