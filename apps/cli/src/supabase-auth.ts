/**
 * 在真实 Supabase 项目里建一个 auth 用户，把它的 uid 交给 seed。
 *
 * 为什么非有这一步：`seed` 写的是 **`public.users`**（应用自己的用户表），它与 Supabase 的
 * `auth.users` 之间**没有任何外键**，关联纯靠「id 值相等」这个约定。本地裸 Postgres 里
 * `usr_local_admin` 这种假 id 无所谓（没有真的 auth 层，`auth.uid()` 是个桩），
 * 但指向真 Supabase 时那个 id 必须是一个**真实存在的 auth 用户 uuid** —— 否则
 * `auth.uid()` 永远不等于它，凡走 RLS 的路径这个用户什么都看不见。
 *
 * 走 Auth Admin API 而不是直插 `auth.users` 表：直插要自己补 `auth.identities` 的生成列、
 * 还要依赖 pgcrypto 的 `crypt`/`gen_salt`（就是 `packages/db/src/create-user.ts` 那条路，
 * 它是独立脚本、不可 import），而 Admin API 一个 POST 就够了。
 *
 * 服务端密钥**只在本进程内存里过一遍**，不落盘：`configToEnv` 刻意清空
 * `SUPABASE_SERVICE_ROLE_KEY`，是为了防残留 env 悄悄接管出站凭据，这里不去破坏它。
 */

function clip(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function readId(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as { id?: unknown; user?: { id?: unknown } };
    const id = parsed.id ?? parsed.user?.id;
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}

export interface AuthUserOptions {
  /** `https://<ref>.supabase.co` */
  projectUrl: string;
  serviceRoleKey: string;
  email: string;
  password: string;
  /** 测试注入 */
  fetchImpl?: typeof fetch;
}

export type AuthUserResult =
  | { ok: true; id: string; created: boolean }
  | { ok: false; reason: string };

/** 按邮箱找已有用户（重跑 init 时用；email 大小写不敏感） */
async function findByEmail(
  doFetch: typeof fetch,
  base: string,
  headers: Record<string, string>,
  email: string,
): Promise<string | null> {
  const res = await doFetch(`${base}/auth/v1/admin/users?page=1&per_page=200`, { headers });
  if (!res.ok) return null;
  const raw = await res.text();
  try {
    const parsed = JSON.parse(raw) as { users?: { id?: unknown; email?: unknown }[] };
    const hit = parsed.users?.find(
      (u) => typeof u.email === "string" && u.email.toLowerCase() === email.toLowerCase(),
    );
    return typeof hit?.id === "string" && hit.id ? hit.id : null;
  } catch {
    return null;
  }
}

/**
 * 建（或找回）一个已激活的 auth 用户，返回它的 uid。
 *
 * 「已存在」不算失败：重跑 `init` 时用户就在那儿，把它的 uid 找回来接着用才对 ——
 * 否则每次重跑都报一个红，用户会以为装坏了。
 */
export async function ensureAuthUser(opts: AuthUserOptions): Promise<AuthUserResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const base = opts.projectUrl.replace(/\/+$/, "");
  const headers = {
    apikey: opts.serviceRoleKey,
    Authorization: `Bearer ${opts.serviceRoleKey}`,
    "Content-Type": "application/json",
  };

  let res: Response;
  let raw: string;
  try {
    res = await doFetch(`${base}/auth/v1/admin/users`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email: opts.email, password: opts.password, email_confirm: true }),
    });
    raw = await res.text();
  } catch (err) {
    return { ok: false, reason: `连不上 ${base}：${(err as Error).message}` };
  }

  if (res.ok) {
    const id = readId(raw);
    if (id) return { ok: true, id, created: true };
    return { ok: false, reason: `Admin API 建了用户却没回 id：${clip(raw)}` };
  }

  if (res.status === 422 || /already|registered|exists/i.test(raw)) {
    const id = await findByEmail(doFetch, base, headers, opts.email);
    if (id) return { ok: true, id, created: false };
    return { ok: false, reason: `邮箱 ${opts.email} 已存在，但列表里没找到它` };
  }
  return { ok: false, reason: `建 auth 用户失败 HTTP ${res.status}：${clip(raw)}` };
}
