/**
 * profiles 路由注入测试（fastify.inject + mock getDb）。
 * 回归锚点：DELETE/PATCH 归属校验（他人或不存在 → 404）、POST schema 拒绝不插库。
 * 说明：表对象保留真（eq 需要真列），仅 getDb 换成可编程 stub。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { getDb } from "@remember/db";
import { managerProfilesRoutes } from "./profiles.js";

const getDbMock = vi.fn();
vi.mock("@remember/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@remember/db")>();
  return { ...actual, getDb: () => getDbMock() };
});

/** 可编程 query 链；delete→returning、select→limit、update→where、insert→values。 */
function makeDb() {
  const delRet = vi.fn();
  const selectRow = vi.fn();
  const insert = vi.fn(async (_row: Record<string, unknown>) => undefined);
  const db = {
    delete: () => ({ where: () => ({ returning: delRet }) }),
    select: () => ({ from: () => ({ where: () => ({ limit: () => selectRow() }) }) }),
    update: () => ({ set: () => ({ where: vi.fn(async () => undefined) }) }),
    insert: () => ({ values: insert }),
  };
  return { db, delRet, selectRow, insert };
}

async function buildApp() {
  const app = Fastify({ logger: false });
  app.addHook("preHandler", async (req) => {
    req.admin = { userId: "user_a" };
  });
  await managerProfilesRoutes(app);
  return app;
}

const validProfile = {
  name: "助手",
  provider: "deepseek",
  model: "deepseek-chat",
  projectId: "proj_a",
};

describe("profiles routes", () => {
  beforeEach(() => {
    getDbMock.mockReset();
  });

  describe("DELETE /profiles/:id", () => {
    it("命中（归属通过，返回行非空）→ 200 {ok:true}", async () => {
      const { db, delRet } = makeDb();
      getDbMock.mockReturnValue(db);
      delRet.mockResolvedValue([{ id: "prof_1" }]);
      const app = await buildApp();

      const res = await app.inject({ method: "DELETE", url: "/profiles/prof_1" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    });

    it("非本人/不存在（DB 无返回行，即 where 含 id+userId 未命中）→ 404", async () => {
      const { db, delRet } = makeDb();
      getDbMock.mockReturnValue(db);
      delRet.mockResolvedValue([]);
      const app = await buildApp();

      const res = await app.inject({ method: "DELETE", url: "/profiles/not_mine" });
      expect(res.statusCode).toBe(404);
      expect(res.json().message).toContain("Profile 不存在");
    });
  });

  describe("PATCH /profiles/:id", () => {
    it("不存在/非本人（先查无此归属行）→ 404，不进 update", async () => {
      const { db, selectRow } = makeDb();
      getDbMock.mockReturnValue(db);
      selectRow.mockResolvedValue([]);
      const app = await buildApp();

      const res = await app.inject({
        method: "PATCH",
        url: "/profiles/ghost",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ name: "改名" }),
      });
      expect(res.statusCode).toBe(404);
    });

    it("归属命中 → 200", async () => {
      const { db, selectRow } = makeDb();
      getDbMock.mockReturnValue(db);
      // PATCH parse partial 后查 profile 需归属命中（带 projectId）
      selectRow.mockResolvedValue([{ id: "prof_1", projectId: "proj_a" }]);
      const app = await buildApp();

      const res = await app.inject({
        method: "PATCH",
        url: "/profiles/prof_1",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ name: "改名" }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    });
  });

  describe("POST /profiles", () => {
    it("合法创建 → 200 返回新 id，插库收到 userId/name", async () => {
      const { db, selectRow, insert } = makeDb();
      getDbMock.mockReturnValue(db);
      // assertProjectBelongsToUser 查询 projects 需命中
      selectRow.mockResolvedValueOnce([{ id: "proj_a" }]);
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/profiles",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify(validProfile),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toMatch(/^prof_/);
      const args = insert.mock.calls[0]?.[0];
      expect(args?.userId).toBe("user_a");
      expect(args?.name).toBe("助手");
      expect(args?.projectId).toBe("proj_a");
    });

    it("name 为空 → 拒绝且不插库", async () => {
      const { db, insert } = makeDb();
      getDbMock.mockReturnValue(db);
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/profiles",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ ...validProfile, name: "" }),
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(insert).not.toHaveBeenCalled();
    });
  });
});
