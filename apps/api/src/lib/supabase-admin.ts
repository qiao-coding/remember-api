import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../env.js";

/**
 * 惰性 Supabase service-role 客户端。
 * 仅用于 JWT 缺 email claim 等罕见场景的 `auth.getUser(token)` 兜底，不在请求热路径上。
 */
let _client: SupabaseClient | null = null;

export function getAdminSupabase(): SupabaseClient {
  if (!_client) {
    _client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  }
  return _client;
}
