/**
 * keys 路由注入测试（fastify.inject + mock getDb）。
 * 回归锚点：DELETE /keys/:id 归属校验（他人 → 404）、PATCH 布尔校验、POST 明文只返回一次。
 * 说明：表对象保留真（eq 需要真列），仅把 getDb 换成可编程 stub，绝不触库。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { getDb } from "@remember/db";
import { maskApiKey } from "@remember/shared";
import { managerKeysRoutes } from "./keys.js";

const getDbMock = vi.fn();
vi.mock("@remember/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@remember/db")>();
  return { ...actual, getDb: () => getDbMock() };
});

/** 可编程 query 链；返回插桩句柄供断言。 */
function makeDb(opts: { selectRows?: unknown[]; valuesError?: unknown; returnRows?: unknown[] } = {}) {
  const { selectRows = [], valuesError, returnRows = [] } = opts;
  const values = vi.fn(async (_row: Record<string, string>) => {
    if (valuesError) throw valuesError;
  });
  const returning = vi.fn(async () => returnRows);
  const db = {
    insert: () => ({ values }),
    update: () => ({ set: () => ({ where: () => ({ returning }) }) }),
    delete: () => ({ where: () => ({ returning }) }),
    select: () => ({
      from: () => ({ where: () => ({ orderBy: () => [], limit: () => Promise.resolve(selectRows) }) }),
    }),
  };
  return { db, values, returning };
}

async function buildApp() {
  const app = Fastify({ logger: false });
  // 绕过 supabase-auth：直接注入 admin
  app.addHook("preHandler", async (req) => {
    req.admin = { userId: "user_a" };
  });
  await managerKeysRoutes(app);
  return app;
}

describe("keys routes", () => {
  beforeEach(() => {
    getDbMock.mockReset();
  });

  describe("DELETE /keys/:id", () => {
    it("命中（归属校验通过，返回行非空）→ 200 {ok:true}", async () => {
      const { db, returning } = makeDb();
      getDbMock.mockReturnValue(db);
      returning.mockResolvedValue([{ id: "key_1" }]);
      const app = await buildApp();

      const res = await app.inject({ method: "DELETE", url: "/keys/key_1" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
      expect(returning).toHaveBeenCalledTimes(1);
    });

    it("非本人/不存在（DB 无返回行）→ 404", async () => {
      const { db, returning } = makeDb();
      getDbMock.mockReturnValue(db);
      returning.mockResolvedValue([]);
      const app = await buildApp();

      const res = await app.inject({ method: "DELETE", url: "/keys/not_mine" });
      expect(res.statusCode).toBe(404);
      expect(res.json().message).toContain("API Key 不存在");
    });
  });

  describe("PATCH /keys/:id", () => {
    it("disabled 非布尔 → 被 schema 拒绝（不进 DB）", async () => {
      const { db, returning } = makeDb();
      getDbMock.mockReturnValue(db);
      const app = await buildApp();

      const res = await app.inject({
        method: "PATCH",
        url: "/keys/key_1",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ disabled: "yes" }),
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(returning).not.toHaveBeenCalled();
    });

    it("合法禁用且命中 → 200", async () => {
      const { db, returning } = makeDb();
      getDbMock.mockReturnValue(db);
      returning.mockResolvedValue([{ id: "key_1" }]);
      const app = await buildApp();

      const res = await app.inject({
        method: "PATCH",
        url: "/keys/key_1",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ disabled: true }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    });

    it("不存在 → 404", async () => {
      const { db, returning } = makeDb();
      getDbMock.mockReturnValue(db);
      returning.mockResolvedValue([]);
      const app = await buildApp();

      const res = await app.inject({
        method: "PATCH",
        url: "/keys/ghost",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ disabled: false }),
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("POST /keys", () => {
    it("创建走真实 generate/mask，明文只回一次且 prefix/last4 与掩码一致（profileId 必填）", async () => {
      const { db, values } = makeDb({ selectRows: [{ id: "prof_a", projectId: "proj_a" }] });
      getDbMock.mockReturnValue(db);
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/keys",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ name: "本地调试", profileId: "prof_a" }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toMatch(/^key_/);
      expect(body.key.length).toBeGreaterThan(10);
      expect(body.profileId).toBe("prof_a");
      // 掩码一致性：prefix…last4 == maskApiKey(key)
      const { prefix, last4 } = maskApiKey(body.key);
      expect(body.prefix).toBe(prefix);
      expect(body.last4).toBe(last4);
      // 落库的是 hash 而非明文
      const insertArgs = values.mock.calls[0]?.[0];
      expect(insertArgs).toBeDefined();
      expect(insertArgs?.userId).toBe("user_a");
      expect(insertArgs?.name).toBe("本地调试");
      expect(insertArgs?.profileId).toBe("prof_a");
      expect(insertArgs?.hash).toBeTruthy();
      expect(insertArgs?.hash).not.toBe(body.key);
    });

    it("name 为空 → 拒绝且不插库", async () => {
      const { db, values } = makeDb();
      getDbMock.mockReturnValue(db);
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/keys",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ name: "" }),
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(values).not.toHaveBeenCalled();
    });
  });

  describe("POST /keys 绑定个人 model + 自定义 secret", () => {
    it("绑定已有 profile + 自定义 secret：明文即所给值、掩码一致、profileId 落库", async () => {
      const { db, values } = makeDb({ selectRows: [{ id: "prof_a", projectId: "proj_a" }] });
      getDbMock.mockReturnValue(db);
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/keys",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ name: "agentA", profileId: "prof_a", secret: "sk-12345678" }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.key).toBe("sk-12345678");
      expect(body.profileId).toBe("prof_a");
      const { prefix, last4 } = maskApiKey(body.key);
      expect(body.prefix).toBe(prefix);
      expect(body.last4).toBe(last4);
      const ins = values.mock.calls[0]?.[0];
      expect(ins?.profileId).toBe("prof_a");
      expect(ins?.hash).toBeTruthy();
      expect(ins?.hash).not.toBe(body.key);
    });

    it("不传 profileId → 400 且不插库（强制绑定个人 model）", async () => {
      const { db, values } = makeDb();
      getDbMock.mockReturnValue(db);
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/keys",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ name: "无绑定" }),
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(values).not.toHaveBeenCalled();
    });

    it("secret 过短 → 400 且不插库", async () => {
      const { db, values } = makeDb();
      getDbMock.mockReturnValue(db);
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/keys",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ name: "x", secret: "short" }),
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(values).not.toHaveBeenCalled();
    });

    it("profileId 不属于当前用户 → 400 且不插库", async () => {
      const { db, values } = makeDb(); // select 无命中
      getDbMock.mockReturnValue(db);
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/keys",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ name: "x", profileId: "prof_not_mine" }),
      });
      expect(res.statusCode).toBe(400);
      expect(values).not.toHaveBeenCalled();
    });

    it("重复自定义 secret（hash 唯一冲突 23505）→ 409", async () => {
      const { db, values } = makeDb({ selectRows: [{ id: "prof_a", projectId: "proj_a" }], valuesError: { code: "23505" } });
      getDbMock.mockReturnValue(db);
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/keys",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ name: "dup", profileId: "prof_a", secret: "sk-99999999" }),
      });
      expect(res.statusCode).toBe(409);
    });
  });

  describe("PATCH /keys/:id 换绑/解绑", () => {
    it("换绑到本人 profile → 200", async () => {
      const { db, returning } = makeDb({ selectRows: [{ id: "prof_b", projectId: "proj_b" }], returnRows: [{ id: "key_1" }] });
      getDbMock.mockReturnValue(db);
      const app = await buildApp();

      const res = await app.inject({
        method: "PATCH",
        url: "/keys/key_1",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ profileId: "prof_b" }),
      });
      expect(res.statusCode).toBe(200);
      expect(returning).toHaveBeenCalled();
    });

    it("解绑 profileId=null → 400（不允许解绑成空）", async () => {
      const { db, returning } = makeDb({ returnRows: [{ id: "key_1" }] });
      getDbMock.mockReturnValue(db);
      const app = await buildApp();

      const res = await app.inject({
        method: "PATCH",
        url: "/keys/key_1",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ profileId: null }),
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });

    it("换绑到他人/不存在的 profile → 400", async () => {
      const { db, returning } = makeDb(); // select 无命中
      getDbMock.mockReturnValue(db);
      const app = await buildApp();

      const res = await app.inject({
        method: "PATCH",
        url: "/keys/key_1",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ profileId: "prof_x" }),
      });
      expect(res.statusCode).toBe(400);
      expect(returning).not.toHaveBeenCalled();
    });
  });
});
