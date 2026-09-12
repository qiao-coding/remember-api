# remember-api 部署 runbook —— 自有服务器 + Docker Compose

目标机：`YOUR_SERVER_IP`（你自己的服务器 —— VPS / 独服 / 家里闲置的主机都行；Debian/Ubuntu，推荐 ≥2 GiB 内存）。栈：**api（Fastify :4000，公网）+ mem0-bridge（:8001，仅内网）**，DB 在 Supabase 托管的 Postgres 上；**没有 Auth 通道**。无域名 → 先 IP + HTTP（Bearer 明文，个人自用可接受；HTTPS + 域名属上线前加固，见文末）。

> 库：本 runbook 按 **Supabase** 写，唯一的 Supabase 专属动作是把根 CA 填进 `DATABASE_SSL_CA_PEM`。网关（`/v1`）与记忆本身不依赖 Supabase，它只是「托管 Postgres」的一种来源 —— 换成别的 PostgreSQL 时把这个变量留空即可（公开 CA 走系统信任库）。`auth.uid()` 桩由 `db:migrate` 自动补，不用手工加。
> 网络：主机需能直连 Docker Hub / npm / HuggingFace（海外机通常直接可达）；连不上就换镜像源，或走第 2 步「本地 build + save/load」。
> 内存：≥2 GiB 直接服务器 build；若机子 <2 GiB 或 build 时 OOM（pnpm 全量 install 峰值高），走第 2 步「本地 build + save/load」。

## 0. 前置清单
- [ ] 服务器：Docker + compose v2（`docker --version`、`docker compose version`）。
- [ ] Supabase 项目：库里结构由本 runbook 建表/种子（第 3 步）。`SEED_USER_ID` 填一个 UUID 即可 —— 本项目没有控制台，也不再使用 Supabase Auth，它只是种子数据的 owner id（想沿用 Supabase 后台 Authentication → Users 里某个 uid 也行，但不再有必要）。
- [ ] 根 CA 的 PEM 内容：Supabase 项目后台 **Database → Settings → SSL Configuration → Download certificate** 下载 `prod-ca-2021.crt`，内容整段填进 `.env.production` 的 `DATABASE_SSL_CA_PEM`（第 1 步）。用公开 CA 的 PostgreSQL 则留空。

## 1. 在服务器放代码 + 环境
部署栈（`Dockerfile` / `docker-compose.yml` / `.dockerignore` / `scripts/`）随仓库发布，clone 下来即可 build。目录统一 `/opt/remember-api`。
```bash
sudo git clone https://github.com/qiao-coding/remember-api.git /opt/remember-api
sudo chown -R "$USER":"$USER" /opt/remember-api
cd /opt/remember-api
```
> 服务器连不上 GitHub 时改走离线：本机 `git archive` 打包，或直接拷 `Dockerfile`、`docker-compose.yml`、`.dockerignore`、`.env.production.example`、`scripts/` 到 `/opt/remember-api`。

填环境变量（含密钥，勿提交）：
```bash
cd /opt/remember-api
cp .env.production.example .env.production
# 编辑 .env.production：DATABASE_URL / MIGRATE_DATABASE_URL / SEED_USER_ID
#   DATABASE_SSL_CA_PEM（Supabase 的 prod-ca-2021.crt 内容；公开 CA 的库留空）
#   API_KEY_PEPPER / ENCRYPTION_KEY 用 `openssl rand -hex 32` 生成
#   UPSTREAM_API_KEY / UPSTREAM_BASE_URL（任意 OpenAI 兼容厂商；BASE_URL 留空按 provider 用各家默认端点）
#   SEED_PROVIDER / SEED_MODEL（样例 Profile 走哪家哪个模型，默认 deepseek/deepseek-chat）
chmod 600 .env.production
```

## 2. 构建/导入镜像（两条路）
**A. 服务器直接 build（推荐，网络直达时）**
```bash
cd /opt/remember-api
docker compose build        # 仅 build，不启动
```
**B. 本地 build + save/load**（小内存机/镜像源受限时的备选）
```bash
# 本地：
docker build -t remember-api/api:0.1.0 .
docker build -t remember-api/mem0-bridge:0.1.0 scripts/mem0-bridge
docker save remember-api/api:0.1.0 remember-api/mem0-bridge:0.1.0 | gzip > remember-images.tgz
# 传上服务器后：
gunzip -c remember-images.tgz | docker load
```

## 3. 首次引导：建表 + 种子
```bash
cd /opt/remember-api
docker compose --profile init run --rm db-init   # 跑 migrate + seed（幂等）
```
> 期间会连 Supabase DDL（直连串）。失败先查 `.env.production` 的 `MIGRATE_DATABASE_URL` 与 `SEED_USER_ID`。

## 4. 预置 embedding 模型（bridge 首启前，一次即可）
能直连官方 HF 就用官方（无需 hf-mirror）：
```bash
export HF_ENDPOINT=https://huggingface.co
bash scripts/mem0-bridge/download-model.sh
```
> 成功后再启服务；失败会输出 fallback 指引（换网络下载 → 拷入卷，见脚本内 [A]/[B]）。

## 5. 起服务
```bash
docker compose up -d
docker compose ps                     # api healthy / mem0-bridge healthy
curl -s http://127.0.0.1:4000/health # {"ok":true,"service":"remember-api"}
docker compose logs -f api
```

## 6. 放行公网端口
云厂商安全组 / 系统防火墙放行 **TCP 4000**（`0.0.0.0/0`）。**8001 不放行**（mem0 仅内网）。

## 7. 冒烟（公网）
```bash
# OpenAI 兼容网关：应 200 出 profile 模型列表
curl -s -H "Authorization: Bearer $BOOTSTRAP_API_KEY" \
  http://YOUR_SERVER_IP:4000/v1/models
# 记忆链路：开着 memoryEnabled 的 profile 发一条对话 → 记忆落在 mem0-bridge
curl -s http://127.0.0.1:8001/health   # 宿主机需进 docker 网络验证（docker exec 进 api 容器 curl 同效）
```

## 8. OpenAI 兼容客户端接入（把工作台指向这个网关）
`/v1` 是 OpenAI 兼容协议（`GET /v1/models` + `POST /v1/chat/completions`），任何支持自定义 base_url 的 OpenAI 兼容客户端都能接，例如：
```bash
# DeepSeek Harness / OpenAI SDK / 自定义 base_url 工具：
#   base_url = http://YOUR_SERVER_IP:4000/v1
#   api_key  = 该 key 绑定的个人 model 的 rma_ key（用 `remember-api key new` 发；或用 BOOTSTRAP_API_KEY 冒烟）
# 一个 key 绑一个「个人 model(子 agent)」，模型间互相隔离、共享项目记忆
```
> Claude Code 走 Anthropic 协议，不能直连本网关 `/v1/chat/completions`；若要让 Claude Code 共享记忆，需在其前面加一层 Anthropic→OpenAI 协议翻译（如 LiteLLM 之类现成代理），不属本 runbook 范畴。

## 运维速查
| 操作 | 命令 |
|---|---|
| 看状态/日志 | `docker compose ps` / `docker compose logs -f api`（或 `mem0-bridge`） |
| 重启 api | `docker compose restart api` |
| 升级（改代码后） | 重 build/load → `docker compose up -d`（bridge 数据在 `mem0_data` 卷，不丢） |
| 重新跑迁移 | `docker compose --profile init run --rm db-init` |
| 临时走 Postgres 记忆 | `api` 服务去掉 `MEM0_BASE_URL` 环境变量后 `up -d`（fallback 自动生效） |
| 释放 | `docker compose down`（保留卷）；`docker compose down -v` 连卷清掉 |

## 上线前加固（本轮不做，另开任务）
- HTTPS：绑定域名 + Caddy 自动证书（替代现在的 IP + HTTP 明文）。
- api 代码：SIGTERM graceful shutdown（现无信号处理，停容器会掐断流式）；CORS `origin:true` → 白名单 env。
