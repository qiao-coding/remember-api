# remember-api 部署 runbook —— 阿里云轻量 VPS + Docker Compose

目标机：`8.148.252.84`（阿里云轻量 2vCPU/**1 GiB**/30GiB，宝塔 Linux）。栈：**api（Fastify :4000，公网）+ mem0-bridge（:8001，仅内网）**，DB/Auth 全在 Supabase。无域名 → 先 IP + HTTP。

> 内存 1 GiB 是硬约束：本机建 2 GiB swap 兜底；bridge 已 `mem_limit: 512m`；宝塔里不用的 MySQL/PHP 等常驻服务能停就停。`docker stats` 观察，仍 OOM → 升 2 GiB 或把 bridge 挪走。

## 0. 前置清单
- [ ] 服务器：Docker + compose v2（`docker --version`、`docker compose version`；宝塔「Docker 管理器」或 `yum install docker-ce docker-compose-plugin`）。
- [ ] Supabase 项目：库里结构已建（migrate/seed 由本 runbook 跑）；先**登录一次控制台**拿登录用户的 auth `uid`（Supabase → Authentication → Users → UUID）。
- [ ] CA 文件 `supabase-ca.pem`：本机在 `packages/db/certs/supabase-ca.pem`（gitignored 私有根 CA，client.ts verify-full 必需）。拷到服务器 `/opt/remember-api/.secrets/supabase-ca.pem`（`chmod 600`）。
- [ ] 1 GiB 先建 swap：
  ```bash
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  ```

## 1. 在服务器放代码 + 环境
仓库**无 git remote**，只能上传。目录统一 `/opt/remember-api`。
```bash
sudo mkdir -p /opt/remember-api/.secrets
# 上传内容：docker-compose.yml、.env.production、.secrets/supabase-ca.pem
# （本仓库新增的 Dockerfile/.dockerignore/.env.production.example/scripts/mem0-bridge 同理上传，供在服务器直接 build 时用）
```

填环境变量（含密钥，勿提交）：
```bash
cd /opt/remember-api
cp .env.production.example .env.production
# 编辑 .env.production：DATABASE_URL / MIGRATE_DATABASE_URL / SUPABASE_URL / SEED_USER_ID
#   API_KEY_PEPPER / ENCRYPTION_KEY 用 `openssl rand -hex 32` 生成
#   DEEPSEEK_API_KEY（seed profile 兜底）
chmod 600 .env.production .secrets/supabase-ca.pem
```

## 2. 构建/导入镜像（两条路二选一）
**A. 本地 build + save/load（推荐，1 GiB 机不跑全量 pnpm install）**
```bash
# 本地（registry 可达处，可配 npmmirror）：
docker build -t remember-api/api:0.1.0 .
docker build -t remember-api/mem0-bridge:0.1.0 scripts/mem0-bridge
docker save remember-api/api:0.1.0 remember-api/mem0-bridge:0.1.0 | gzip > remember-images.tgz
# 传上服务器后：
gunzip -c remember-images.tgz | docker load
```
**B. 服务器直接 build**（`docker compose build`，npm/pypi 网络按镜像内配置；不推荐但可行）。

## 3. 首次引导：建表 + 种子
```bash
cd /opt/remember-api
docker compose --profile init run --rm db-init   # 跑 migrate + seed（幂等）
```
> 期间会连 Supabase DDL（直连串）。失败先查 `.env.production` 的 `MIGRATE_DATABASE_URL` 与 `SEED_USER_ID`。

## 4. 预置 embedding 模型（bridge 首启前，一次即可）
```bash
bash scripts/mem0-bridge/download-model.sh
```
> 成功后再启服务；失败走脚本内 fallback（外网机下载 → 拷卷）。

## 5. 起服务
```bash
docker compose up -d
docker compose ps                     # api healthy / mem0-bridge healthy
curl -s http://127.0.0.1:4000/health # {"ok":true,"service":"remember-api"}
docker compose logs -f api
```

## 6. 放行公网端口
宝塔「安全」/ 阿里云安全组：放行 **TCP 4000**（`0.0.0.0/0`）。**8001 不放行**（mem0 仅内网）。

## 7. 冒烟（公网）
```bash
# OpenAI 兼容网关：应 200 出 profile 模型列表
curl -s -H "Authorization: Bearer $BOOTSTRAP_API_KEY" \
  http://8.148.252.84:4000/v1/models
# 控制台登录（web 端后续接）→ /api/* 通
# 记忆链路：开着 memoryEnabled 的 profile 发一条对话 → 记忆出现在 mem0-bridge
curl -s http://127.0.0.1:8001/health   # 宿主机需进 docker 网络验证（docker exec 进 api 容器 curl 同效）
```

## 运维速查
| 操作 | 命令 |
|---|---|
| 看状态/日志 | `docker compose ps` / `docker compose logs -f api`（或 `mem0-bridge`） |
| 重启 api | `docker compose restart api` |
| 升级（改代码后） | 重 build/load → `docker compose up -d`（bridge 数据在 `mem0_data` 卷，不丢） |
| 重新跑迁移 | `docker compose --profile init run --rm db-init` |
| 临时走 Postgres 记忆 | `api` 服务去掉 `MEM0_BASE_URL` 环境变量后 `up -d`（fallback 自动生效） |
| 释放 | `docker compose down`（保留卷）；`docker compose down -v` 连卷清掉 |

## 上线前加固（不在首版，另开任务）
- HTTPS：绑定域名 + Caddy 自动证书（现在 IP+HTTP，Bearer/JWT 明文，个人自用可接受）。
- api 代码：SIGTERM graceful shutdown（现无信号处理，停容器会掐断流式）；CORS `origin:true` → 白名单 env。
- Supabase region 亚太化 + 这套 Compose 平移到 Fly/香港节点（远期「共享全球」）。
