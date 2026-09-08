# syntax=docker/dockerfile:1
# mem0-bridge —— remember-api 的记忆后端（FastAPI + mem0ai + fastembed + 本地 qdrant/SQLite）。
# 数据全落 MEM0_DIR（compose 挂 mem0_data:/var/lib/mem0），升级不丢。
#
# 注意：
#   - pip 走阿里镜像（大陆构建快）；如需改回官方源删掉 --index-url。
#   - embedding 模型 bge-small-zh-v1.5 不在镜像内（90MB，且大陆直连 HF 不稳）——
#     首启前先跑一次 scripts/mem0-bridge/download-model.sh 把模型填进卷，常驻时 HF_HUB_OFFLINE=1。
#   - mem0ai 版本未钉死：与本地 .mem0-venv 若有行为差异，按本地实测版本加 `==x.y.z` 对齐。

FROM python:3.11-slim
ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONUNBUFFERED=1 \
    HF_HUB_OFFLINE=1 \
    HF_ENDPOINT=https://hf-mirror.com \
    MEM0_TELEMETRY=false

RUN pip install --index-url https://mirrors.aliyun.com/pypi/simple/ \
      fastapi \
      "uvicorn[standard]" \
      python-dotenv \
      mem0ai \
      fastembed

WORKDIR /app
COPY main.py /app/main.py

# 运行时可被 compose environment 覆盖；MEM0_DIR/FASTEMBED_CACHE_PATH 指向持久卷
ENV MEM0_DIR=/var/lib/mem0 \
    MEM0_HOST=0.0.0.0 \
    MEM0_PORT=8001 \
    FASTEMBED_CACHE_PATH=/var/lib/mem0/model_cache

EXPOSE 8001
# main.py 底部 uvicorn.run 读 MEM0_HOST/MEM0_PORT
CMD ["python", "/app/main.py"]
