#!/usr/bin/env bash
# 预置 fastembed embedding 模型到 mem0_data 卷，供 bridge 常驻（HF_HUB_OFFLINE=1）离线使用。
# 前提：镜像已构建（docker compose build mem0-bridge 或本地 save/load 过 remember-api/mem0-bridge:0.1.0）。
# 用法：在仓库根（docker-compose.yml 所在目录）执行：bash scripts/mem0-bridge/download-model.sh
# 模型：BAAI/bge-small-zh-v1.5（512 维 ONNX，约 90MB），落 /var/lib/mem0/model_cache。
set -uo pipefail
cd "$(dirname "$0")/../.."

echo ">> 在 bridge 容器内触发 fastembed 下载（写 /var/lib/mem0/model_cache = mem0_data 卷）…"
echo ">> 大陆网络下 HF 直连不稳，走 HF_ENDPOINT=${HF_ENDPOINT:-https://hf-mirror.com}"

if docker compose run --rm --no-deps \
  -e HF_HUB_OFFLINE=0 \
  -e "HF_ENDPOINT=${HF_ENDPOINT:-https://hf-mirror.com}" \
  -e FASTEMBED_CACHE_PATH=/var/lib/mem0/model_cache \
  mem0-bridge \
  python -c "from fastembed import TextEmbedding; TextEmbedding('BAAI/bge-small-zh-v1.5'); print('OK: model cached under /var/lib/mem0/model_cache')"; then
  echo ">> 模型已入卷。bridge 常驻会以 HF_HUB_OFFLINE=1 跑，无需外网。"
else
  cat >&2 <<'EOF'

>> fastembed 直连下载失败（国内网络常见）。换两条路之一：

  [A] 换网络重试：先临时起一个走外网的容器下载，再拷进卷——
      在能直连/代理外网的机器上：
        FASTEMBED_CACHE_PATH=/tmp/fastembed_cache \
          python -c "from fastembed import TextEmbedding; TextEmbedding('BAAI/bge-small-zh-v1.5')"
        tar -C /tmp/fastembed_cache -czf /tmp/fastembed_cache.tgz .
      拷到服务器后（仓库根执行）：
        docker run --rm -v remember-api_mem0_data:/data -v "$PWD/fastembed_cache.tgz":/m/c.tgz:ro \
          alpine sh -c 'mkdir -p /data/model_cache && tar -C /data/model_cache -xzf /m/c.tgz'

  [B] 若 HF_ENDPOINT 镜像仍不行，README 提到的 GCS 分段 Range 下载同理：把解压好的
      fastembed 缓存目录放进服务器后按 [A] 的 docker run 命令灌入卷。

完成后可验证：docker compose run --rm --no-deps mem0-bridge python -c \
  "from fastembed import TextEmbedding; list(TextEmbedding('BAAI/bge-small-zh-v1.5').embed(['x'])); print('offline ok')"
EOF
  exit 1
fi
