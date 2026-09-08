#!/usr/bin/env bash
# remember-api 安全冒烟：认证边界 / 越权隔离
# 前置：API 已在 :4000 运行
# 依赖：curl（无 jq）；需设置 SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_USER_EMAIL / SUPABASE_USER_PASSWORD
set -u

API="${API:-http://localhost:4000}"
SUPABASE_URL="${SUPABASE_URL:?需要设置 SUPABASE_URL}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:?需要设置 SUPABASE_ANON_KEY}"
SUPABASE_USER_EMAIL="${SUPABASE_USER_EMAIL:?需要设置 SUPABASE_USER_EMAIL}"
SUPABASE_USER_PASSWORD="${SUPABASE_USER_PASSWORD:?需要设置 SUPABASE_USER_PASSWORD}"

PASS=0; FAIL=0
pass() { PASS=$((PASS+1)); echo "  ✅ $1 (HTTP $2)"; }
fail() { FAIL=$((FAIL+1)); echo "  ❌ $1 (HTTP $2, 期望 $3)"; }
# expect_code <描述> <期望码> <实际码>
expect() { [ "$3" = "$2" ] && pass "$1" "$3" || fail "$1" "$3" "$2"; }

code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

section() { echo ""; echo "═══ $1 ═══"; }

# GoTrue 密码登录，取 access_token（错误凭证返回 400 invalid_grant）
gotrue_login() {
  curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
    -H "Content-Type: application/json" \
    -H "apikey: $SUPABASE_ANON_KEY" \
    -d "{\"email\":\"$SUPABASE_USER_EMAIL\",\"password\":\"$SUPABASE_USER_PASSWORD\"}"
}

section "0. 公开端点（无需鉴权）"
expect "GET /health 公开可达" 200 "$(code "$API/health")"

section "1. /v1 网关 Bearer API key 边界"
expect "无 Authorization → 401" 401 "$(code "$API/v1/models")"
expect "无效 rma_ key → 401"  401 "$(code -H "Authorization: Bearer rma_invalid_key_0000" "$API/v1/models")"
expect "admin token 误当 Bearer → 401" 401 "$(code -H "Authorization: Bearer garbage_admin_session" "$API/v1/models")"

section "2. /api 管理后台 Bearer JWT 边界"
expect "无 Authorization → 401" 401 "$(code "$API/api/memories")"
expect "乱写 token → 401"       401 "$(code -H "Authorization: Bearer garbage" "$API/api/memories")"
expect "rma_ key 误当 admin → 401" 401 "$(code -H "Authorization: Bearer rma_bootstrap_local" "$API/api/memories")"

section "3. GoTrue 登录错误密码"
expect "密码错误 → 400 invalid_grant" 400 "$(code -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" -H "Content-Type: application/json" -H "apikey: $SUPABASE_ANON_KEY" -d "{\"email\":\"$SUPABASE_USER_EMAIL\",\"password\":\"wrong-password-zzz\"}")"

section "4. 正例（有效凭证应放行）"
LOGIN=$(gotrue_login)
TOKEN=$(echo "$LOGIN" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
if [ -n "$TOKEN" ]; then
  expect "有效 JWT 读 memories → 200" 200 "$(code -H "Authorization: Bearer $TOKEN" "$API/api/memories?limit=1")"
else
  FAIL=$((FAIL+1)); echo "  ❌ 无法获取 access_token"
fi
expect "有效 rma_ key 读 models → 200" 200 "$(code -H "Authorization: Bearer rma_bootstrap_local" "$API/v1/models")"

echo ""
echo "─────────────────────────────"
echo "安全冒烟: ${PASS} 通过 / ${FAIL} 失败"
[ "$FAIL" -eq 0 ] && echo "✅ 全部通过" || exit 1
