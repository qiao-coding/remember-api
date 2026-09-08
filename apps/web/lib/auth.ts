"use client";

import { createBrowserClient } from "@supabase/ssr";

/** 浏览器端 Supabase 客户端（会话存 cookie，配合 middleware 刷新） */
export function createSupabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
