import type { User } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** 服务端组件用的 Supabase 客户端（Next 15 cookies() 为 async） */
export async function createSupabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // 在 Server Component 中调用 set 会抛错，可忽略（middleware 负责刷新）
          }
        },
      },
    },
  );
}

/**
 * 取当前登录用户；auth 服务不可达等异常一律按“未登录”返回 null。
 * 公开页（docs）用它判断是否渲染登录态真实数据，不因 auth 抖动而打不开。
 */
export async function getServerUser(): Promise<User | null> {
  try {
    const supabase = await createSupabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user;
  } catch {
    return null;
  }
}
