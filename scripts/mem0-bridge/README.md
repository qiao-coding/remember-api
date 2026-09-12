# mem0-bridge：Mem0 记忆桥接服务

极简 FastAPI 服务，直接驱动 `mem0ai` 库，为 remember-api 提供 REST 记忆后端。
端点契约对齐 Mem0 官方 server（`POST /memories`、`POST /search`、`GET /memories`、`DELETE /memories/{id}`），
供 `packages/memory` 的 `Mem0MemoryProvider` 调用。

## 为什么不用官方 server

- 官方 `mem0ai/mem0` server 的 embedder 只打包 openai/gemini（无本地 fastembed），没 OpenAI key 会卡死
- 依赖 Postgres + alembic 迁移，部署重
- 本 bridge 单进程：**DeepSeek LLM + fastembed 本地 embedding + qdrant 本地文件 + SQLite 历史**

## 启动

```bash
bash scripts/mem0-bridge/start.sh   # 端口 :8001
```

`start.sh` 自动读取 `apps/api/.env`（`UPSTREAM_API_KEY`，桥接成 mem0 要的 `DEEPSEEK_API_KEY`），并注入 embedding 缓存路径 + 强制离线。

## 首次部署（模型缓存）

embedding 模型 `BAAI/bge-small-zh-v1.5`（512 维，ONNX）必须提前缓存到
`<Temp>/fastembed_cache/fast-bge-small-zh-v1.5/`。国内 huggingface.co 被墙，hf-mirror 也不稳定，
改用 **GCS 分段 Range 下载**（storage.googleapis.com 对 90MB 直连会被掐断，4MB 段稳定）：

```bash
# 分段下载 tar.gz 后解压到 fastembed 缓存目录
# 见 scripts/mem0-bridge/download-model.sh 或手动 curl -r range 循环
```

## 踩过的坑

| 坑 | 修复 |
|---|---|
| `QdrantConfig` 默认 `embedding_model_dims=1536`（OpenAI） | vector_store config 必须显式传 `embedding_model_dims: 512` |
| pydantic 把 messages 转成 ChatMessage 对象 → mem0 内部 `.get()` AttributeError | bridge 里 messages 用 `list[dict]` 原样透传 |
| mem0 `get_all` 要求至少一个 scope id | 无 user_id/agent_id/run_id 时返回 `{results: []}` |
| PostHog 遥测连 us.i.posthog.com 超时 | `MEM0_TELEMETRY=false` |
| 维度不匹配（集合已按错维度创建） | 删除 `~/.mem0/remember/qdrant` 后重启重建 |
