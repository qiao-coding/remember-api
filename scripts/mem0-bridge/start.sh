#!/usr/bin/env bash
# 启动 Mem0 记忆桥接服务（:8001）。
# 前置：apps/api/.env 提供 UPSTREAM_API_KEY；embedding 模型已缓存于 FASTEMBED_CACHE_PATH。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VENV_PY="$ROOT/.mem0-venv/Scripts/python.exe"

# 读取 apps/api/.env（UPSTREAM_API_KEY 等）
if [ -f "$ROOT/apps/api/.env" ]; then
  set -a; source "$ROOT/apps/api/.env"; set +a
fi

# mem0 自带的 LLM provider 认的是 DEEPSEEK_API_KEY 这个旧名；网关侧已改名成 UPSTREAM_API_KEY，
# 这里做一层桥接，否则桥的提炼 key 会静默变空。
export DEEPSEEK_API_KEY="${DEEPSEEK_API_KEY:-${UPSTREAM_API_KEY:-}}"

export MEM0_PORT="${MEM0_PORT:-8001}"
# fastembed 模型缓存（bge-small-zh-v1.5，手动下载后解压于此）
export FASTEMBED_CACHE_PATH="${FASTEMBED_CACHE_PATH:-$HOME/AppData/Local/Temp/fastembed_cache}"
# 强制离线：避免启动时尝试连 HuggingFace（国内被墙）
export HF_HUB_OFFLINE=1
export HF_ENDPOINT="${HF_ENDPOINT:-https://hf-mirror.com}"

exec "$VENV_PY" "$ROOT/scripts/mem0-bridge/main.py"
