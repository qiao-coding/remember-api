#!/usr/bin/env bash
# remember-api 端到端验证：OpenAI 兼容网关 + 记忆写读 + 用量统计
# 前置：Supabase 已迁移+seed，API 已在 :4000 运行
# 依赖：curl（无 jq）；需设置 SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_USER_EMAIL / SUPABASE_USER_PASSWORD
set -euo pipefail

API="${API:-http://localhost:4000}"
BOOTSTRAP_KEY="${BOOTSTRAP_KEY:-rma_bootstrap_local}"
SUPABASE_URL="${SUPABASE_URL:?需要设置 SUPABASE_URL}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:?需要设置 SUPABASE_ANON_KEY}"
SUPABASE_USER_EMAIL="${SUPABASE_USER_EMAIL:?需要设置 SUPABASE_USER_EMAIL}"
SUPABASE_USER_PASSWORD="${SUPABASE_USER_PASSWORD:?需要设置 SUPABASE_USER_PASSWORD}"

pass() { echo "  ✅ $1"; }
fail() { echo "  ❌ $1"; exit 1; }
section() { echo ""; echo "═══ $1 ═══"; }

# GoTrue 密码登录，取 access_token（错误凭证返回 400 invalid_grant）
gotrue_login() {
  curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
    -H "Content-Type: application/json" \
    -H "apikey: $SUPABASE_ANON_KEY" \
    -d "{\"email\":\"$SUPABASE_USER_EMAIL\",\"password\":\"$SUPABASE_USER_PASSWORD\"}"
}

section "1. 健康检查"
HEALTH=$(curl -s "$API/health")
echo "  $HEALTH"
echo "$HEALTH" | grep -q '"ok"' && pass "GET /health" || fail "健康检查失败"

section "2. 模型列表（Bearer 认证）"
MODELS=$(curl -s -H "Authorization: Bearer $BOOTSTRAP_KEY" "$API/v1/models")
echo "$MODELS" | head -c 300; echo ""
echo "$MODELS" | grep -q "remember-dev" && pass "GET /v1/models 返回 remember-dev" || fail "模型列表缺失"

section "3. 管理员登录（GoTrue）"
LOGIN=$(gotrue_login)
echo "$LOGIN" | grep -q '"access_token"' && pass "POST /auth/v1/token?grant_type=password" || fail "登录失败: $LOGIN"
TOKEN=$(echo "$LOGIN" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
[ -n "$TOKEN" ] && pass "提取 access_token" || fail "无法提取 token"

section "4. 非流式对话（写入记忆）"
# Git Bash 下多行中文 JSON 直接 -d 会编码污染，payload 落文件用 --data-binary @
TMP_DIR="$(mktemp -d)"
cat > "$TMP_DIR/chat1.json" <<'EOF'
{
  "model": "remember-dev",
  "remember": { "memory": true },
  "messages": [
    {"role":"user","content":"请记住：我偏好深色主题界面，且习惯用 Vim 键位。"}
  ]
}
EOF
RESP=$(curl -s -X POST "$API/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $BOOTSTRAP_KEY" \
  --data-binary @"$TMP_DIR/chat1.json")
echo "$RESP" | head -c 400; echo ""
echo "$RESP" | grep -q '"content"' && pass "非流式对话返回内容" || fail "非流式无内容"
echo "$RESP" | grep -q '"total_tokens"' && pass "返回 usage" || fail "无 usage"

section "5. 记忆已写入"
SLEEP_S=2
echo "  等待 $SLEEP_S s 让记忆落库…"
sleep "$SLEEP_S"
MEM=$(curl -s -H "Authorization: Bearer $TOKEN" "$API/api/memories?limit=5")
echo "$MEM" | head -c 400; echo ""
echo "$MEM" | grep -q "深色主题" && pass "记忆列表含偏好" || fail "未发现偏好记忆"

section "6. 二次对话（验证记忆检索/连续性）"
cat > "$TMP_DIR/chat2.json" <<'EOF'
{
  "model": "remember-dev",
  "remember": { "memory": true },
  "messages": [
    {"role":"user","content":"我上次说过什么偏好？"}
  ]
}
EOF
RESP2=$(curl -s -X POST "$API/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $BOOTSTRAP_KEY" \
  --data-binary @"$TMP_DIR/chat2.json")
echo "$RESP2" | head -c 400; echo ""
echo "$RESP2" | grep -q '"content"' && pass "二次对话正常" || fail "二次对话失败"

section "7. 流式对话"
cat > "$TMP_DIR/chat3.json" <<'EOF'
{
  "model": "remember-dev",
  "stream": true,
  "messages": [{"role":"user","content":"数 1 到 3"}]
}
EOF
SSE=$(curl -sN -X POST "$API/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $BOOTSTRAP_KEY" \
  --data-binary @"$TMP_DIR/chat3.json")
echo "$SSE" | grep -q "chat.completion.chunk" && pass "SSE 流式输出 chunk" || fail "流式无 chunk"
echo "$SSE" | grep -q "data: \[DONE\]" && pass "SSE 以 [DONE] 结束" || fail "流式未正常结束"

section "8. 用量统计"
USAGE=$(curl -s -H "Authorization: Bearer $TOKEN" "$API/api/usage/summary?days=1")
echo "  $USAGE"
REQS=$(echo "$USAGE" | sed -n 's/.*"requests":\([0-9]*\).*/\1/p')
echo "  请求数: ${REQS:-?}"
[ "${REQS:-0}" -ge 3 ] && pass "已记录 >=3 次请求" || fail "请求数不足 (${REQS:-0})"

echo ""
echo "✅ e2e 全部通过"
