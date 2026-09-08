"use client";

import { createSupabaseBrowser } from "./auth";
import { buildRequestHeaders } from "./http-headers";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** 带 Supabase JWT 的后台请求；401 时刷新会话重试一次，仍失败则登出 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const supabase = createSupabaseBrowser();

  const doFetch = (accessToken?: string | null) =>
    fetch(path, {
      ...init,
      headers: buildRequestHeaders(init, accessToken),
    });

  const {
    data: { session },
  } = await supabase.auth.getSession();
  let res = await doFetch(session?.access_token);

  // token 过期 → 刷新会话后重试一次
  if (res.status === 401 && session) {
    const { data: refreshed } = await supabase.auth.refreshSession();
    if (refreshed.session) {
      res = await doFetch(refreshed.session.access_token);
    }
  }

  if (!res.ok) {
    let msg = `请求失败 (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      // ignore
    }
    if (res.status === 401) {
      await supabase.auth.signOut();
      if (typeof window !== "undefined") window.location.href = "/login";
    }
    throw new ApiError(res.status, msg);
  }
  return (await res.json()) as T;
}
