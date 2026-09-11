/**
 * 在真 Supabase 项目里建 auth 用户，把 uid 交给 seed。
 *
 * 为什么它值得单独测：`public.users` 与 `auth.users` 之间**没有外键**，关联纯靠
 * 「id 值相等」这个约定。seed 写的那个 id 如果不是一个真实存在的 auth uuid，
 * 安装过程**一步都不会报错**，但那个用户在凡走 RLS 的路径下什么都看不见 ——
 * 典型的「全绿却全错」。
 *
 * 这里全用注入的 fetch，不打网络。断言的重点是**判据**：什么时候复用、什么时候
 * 该报错、以及错误里带不带得上足够定位的信息。
 */
import { describe, expect, it, vi } from "vitest";
import { ensureAuthUser } from "./supabase-auth.js";

const OPTS = {
  projectUrl: "https://abcdefghijklmnopqrst.supabase.co",
  serviceRoleKey: "sb_secret_xyz",
  email: "admin@remember.local",
  password: "pw123456",
};

function json(body: unknown, status = 200): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fetchStub(handler: (url: string, init?: RequestInit) => Response) {
  return vi.fn(async (input: string | URL, init?: RequestInit) =>
    handler(String(input), init),
  ) as unknown as typeof fetch;
}

describe("ensureAuthUser：建出来的 uid 是 seed 唯一能对齐的东西", () => {
  it("POST 到 /auth/v1/admin/users，带上 apikey 与 Bearer 两个头，并确认邮箱", async () => {
    let seen: { url: string; init?: RequestInit } | null = null;
    const fetchImpl = fetchStub((url, init) => {
      seen = { url, ...(init ? { init } : {}) };
      return json({ id: "11111111-2222-3333-4444-555555555555" });
    });

    const res = await ensureAuthUser({ ...OPTS, fetchImpl });

    expect(res).toEqual({ ok: true, id: "11111111-2222-3333-4444-555555555555", created: true });
    expect(seen!.url).toBe("https://abcdefghijklmnopqrst.supabase.co/auth/v1/admin/users");
    expect(seen!.init?.method).toBe("POST");
    const headers = seen!.init?.headers as Record<string, string>;
    // 两个头缺一不可：只给 apikey 会 401，只给 Bearer 也一样
    expect(headers.apikey).toBe(OPTS.serviceRoleKey);
    expect(headers.Authorization).toBe(`Bearer ${OPTS.serviceRoleKey}`);
    // 不确认邮箱的话这个用户登不进去（Supabase 默认要求验证）
    expect(JSON.parse(String(seen!.init?.body))).toMatchObject({
      email: OPTS.email,
      password: OPTS.password,
      email_confirm: true,
    });
  });

  it("项目 URL 尾部的斜杠不影响拼路径（用户从 Dashboard 复制来的常带）", async () => {
    let url = "";
    const fetchImpl = fetchStub((u) => {
      url = u;
      return json({ id: "x" });
    });

    await ensureAuthUser({ ...OPTS, projectUrl: `${OPTS.projectUrl}/`, fetchImpl });

    expect(url).toBe("https://abcdefghijklmnopqrst.supabase.co/auth/v1/admin/users");
  });

  it("邮箱已存在（422）→ 把它找回来复用，不算失败", async () => {
    // 重跑 init 时用户就在那儿。每次都报一个红，用户会以为装坏了。
    const seenUrls: string[] = [];
    const fetchImpl = fetchStub((url) => {
      seenUrls.push(url);
      if (url.endsWith("/admin/users")) return json({ msg: "User already registered" }, 422);
      return json({
        users: [
          { id: "other", email: "someone@else.local" },
          { id: "the-existing-uid", email: "ADMIN@remember.local" },
        ],
      });
    });

    const res = await ensureAuthUser({ ...OPTS, fetchImpl });

    expect(res).toEqual({ ok: true, id: "the-existing-uid", created: false });
    expect(seenUrls[1]).toContain("/auth/v1/admin/users?page=1&per_page=200");
  });

  it("说已存在但列表里找不到 → 报错，绝不编一个 uid 出来", async () => {
    // 编一个假 uid 就是「全绿却全错」：seed 会写进一个永远对不上的 id
    const fetchImpl = fetchStub((url) =>
      url.includes("page=1") ? json({ users: [] }) : json({ msg: "already registered" }, 422),
    );

    const res = await ensureAuthUser({ ...OPTS, fetchImpl });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/没找到/);
  });

  it("其它 HTTP 错误 → 带状态码与响应体，够定位", async () => {
    const fetchImpl = fetchStub(() => json({ msg: "Invalid API key" }, 401));

    const res = await ensureAuthUser({ ...OPTS, fetchImpl });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toMatch(/401/);
      expect(res.reason).toMatch(/Invalid API key/);
    }
  });

  it("建成功了却没回 id → 也是失败（宁可不装，也不能拿 undefined 当 uid）", async () => {
    const fetchImpl = fetchStub(() => json({ user: {} }));

    const res = await ensureAuthUser({ ...OPTS, fetchImpl });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/没回 id/);
  });

  it("网络不通 → 报错里带上地址，别只说一句「失败」", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("fetch failed");
    }) as unknown as typeof fetch;

    const res = await ensureAuthUser({ ...OPTS, fetchImpl });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toMatch(/supabase\.co/);
      expect(res.reason).toMatch(/fetch failed/);
    }
  });

  it("超长响应体被截断 —— 错误信息不该把终端刷满", async () => {
    const fetchImpl = fetchStub(() => json({ msg: "x".repeat(5000) }, 500));

    const res = await ensureAuthUser({ ...OPTS, fetchImpl });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason.length).toBeLessThan(400);
  });
});
