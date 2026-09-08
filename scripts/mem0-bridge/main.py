#!/usr/bin/env python
"""remember-api × Mem0 记忆桥接服务（极简 REST，兼容官方 server 契约）。

用 mem0ai 库直接驱动：
  - Embedder: fastembed（本地 ONNX，免外部 key）
  - LLM:      deepseek（原生 provider，infer:false 时不调用）
  - 向量库:    qdrant 本地文件模式
  - 历史:     SQLite

端点与官方 Mem0 server 对齐，供 apps/api 的 Mem0MemoryProvider 调用：
  POST /memories        {messages, user_id, agent_id, metadata, infer} -> {results:[...]}
  POST /search          {query, filters, top_k}                       -> {results:[...]}
  GET  /memories?user_id=&agent_id=&top_k=                            -> {results:[...]}
  DELETE /memories/{id}
  GET  /health
启动：MEM0_DIR + DEEPSEEK_API_KEY 从环境变量读取（apps/api/.env 已含后者）。
"""
import os

from dotenv import load_dotenv

load_dotenv()

# 关闭 mem0ai 的 PostHog 遥测（国内网络连不上 us.i.posthog.com，只会拖慢并刷日志）
os.environ.setdefault("MEM0_TELEMETRY", "false")

# fastembed 首次使用会下载模型；国内网络走 hf-mirror 兜底
os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from mem0 import Memory

MEM0_DIR = os.environ.get("MEM0_DIR") or os.path.join(os.path.expanduser("~"), ".mem0", "remember")
os.makedirs(MEM0_DIR, exist_ok=True)

memory = Memory.from_config(
    {
        "llm": {
            "provider": "deepseek",
            "config": {
                "model": os.environ.get("MEM0_LLM_MODEL", "deepseek-chat"),
                "api_key": os.environ.get("DEEPSEEK_API_KEY", ""),
                "temperature": 0.1,
            },
        },
        "embedder": {
            "provider": "fastembed",
            "config": {"model": os.environ.get("MEM0_EMBEDDER_MODEL", "BAAI/bge-small-zh-v1.5")},
        },
        "vector_store": {
            "provider": "qdrant",
            "config": {
                "path": os.path.join(MEM0_DIR, "qdrant"),
                "collection_name": "remember",
                # 必须显式给维度：QdrantConfig 默认 1536（OpenAI），而 bge-small-zh 是 512，不匹配会报 shapes error
                "embedding_model_dims": 512,
            },
        },
        "history_db_path": os.path.join(MEM0_DIR, "history.db"),
    }
)

app = FastAPI(title="remember-api mem0 bridge", version="0.1.0")


class ChatMessage(BaseModel):
    role: str
    content: str


class MemoryWriteRequest(BaseModel):
    # 保持 dict 列表（mem0 内部解析需要原始 dict，转成 Pydantic 对象会 AttributeError）
    messages: list[dict] | str
    user_id: str | None = None
    agent_id: str | None = None
    run_id: str | None = None
    metadata: dict | None = None
    infer: bool = True


class MemorySearchRequest(BaseModel):
    query: str
    filters: dict | None = None
    top_k: int = 20
    threshold: float = 0.1


class MemoryUpdateRequest(BaseModel):
    text: str | None = None
    data: str | None = None
    metadata: dict | None = None


@app.get("/health")
def health():
    return {"ok": True, "service": "mem0-bridge"}


@app.post("/memories")
def add_memory(req: MemoryWriteRequest):
    result = memory.add(
        req.messages,
        user_id=req.user_id,
        agent_id=req.agent_id,
        run_id=req.run_id,
        metadata=req.metadata,
        infer=req.infer,
    )
    return result


@app.post("/search")
def search_memory(req: MemorySearchRequest):
    result = memory.search(
        req.query,
        top_k=req.top_k,
        filters=req.filters,
        threshold=req.threshold,
    )
    return result


@app.get("/memories")
def list_memories(
    user_id: str | None = None,
    agent_id: str | None = None,
    run_id: str | None = None,
    top_k: int = 100,
):
    filters = {k: v for k, v in {"user_id": user_id, "agent_id": agent_id, "run_id": run_id}.items() if v}
    if not filters:
        # mem0 的 get_all 要求至少一个 scope id；无参数时返回空而非报错
        return {"results": []}
    result = memory.get_all(filters=filters, top_k=top_k)
    return result


@app.delete("/memories/{memory_id}")
def delete_memory(memory_id: str):
    try:
        memory.delete(memory_id)
    except Exception as exc:  # 兼容官方 server：找不到 ID 返回 404
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "deleted", "id": memory_id}


@app.put("/memories/{memory_id}")
def update_memory(memory_id: str, req: MemoryUpdateRequest):
    try:
        memory.update(
            memory_id,
            text=req.text or req.data,
            metadata=req.metadata,
        )
    except Exception as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "updated", "id": memory_id}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=os.environ.get("MEM0_HOST", "127.0.0.1"), port=int(os.environ.get("MEM0_PORT", "8001")))
