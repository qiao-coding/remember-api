/**
 * memories 路由注入测试。
 * mock @remember/memory 的 createMemoryProvider → 内存 store 的 MemoryProvider，
 * 验证归属语义（get(id, userId)：他人 → 404，本人 → 200）与 schema 前置拒绝。
 * 不触 DB：POST/PATCH 均不带 projectId，assertProjectBelongsToUser 直接短路。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { managerMemoriesRoutes } from "./memories.js";

type Mem = { id: string; userId: string; content: string; type: string; pinned?: boolean; importance?: number };

let store = new Map<string, Mem>();

const memoryApi = {
  get: vi.fn(),
  list: vi.fn(async () => []),
  search: vi.fn(async () => []),
  write: vi.fn(async () => ({ id: "m_created" })),
  update: vi.fn(),
  delete: vi.fn(async () => undefined),
};

vi.mock("@remember/memory", () => ({ createMemoryProvider: () => memoryApi }));

memoryApi.get.mockImplementation(async (id: string, userId: string) => {
  const m = store.get(id);
  return m && m.userId === userId ? m : null;
});
memoryApi.update.mockImplementation(async (id: string, _userId: string, body: Partial<Mem>) => {
  const existing = store.get(id);
  return existing ? { ...existing, ...body } : null;
});

async function buildApp() {
  const app = Fastify({ logger: false });
  app.addHook("preHandler", async (req) => {
    req.admin = { userId: "user_a" };
  });
  await managerMemoriesRoutes(app);
  return app;
}

function seed(mem: Mem) {
  store.set(mem.id, mem);
  return mem;
}

describe("memories routes", () => {
  beforeEach(() => {
    store = new Map();
    for (const fn of Object.values(memoryApi)) fn.mockClear();
  });

  describe("GET /memories/:id", () => {
    it("本人记忆 → 200 原样返回", async () => {
      const app = await buildApp();
      const mem = seed({ id: "m_1", userId: "user_a", content: "记一下", type: "decision" });
      const res = await app.inject({ method: "GET", url: "/memories/m_1" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: "m_1", content: "记一下" });
      expect(memoryApi.get).toHaveBeenCalledWith("m_1", "user_a");
      expect(mem.id).toBe("m_1");
    });

    it("他人记忆（归属不符）→ 404", async () => {
      const app = await buildApp();
      seed({ id: "m_f", userId: "user_b", content: "私密", type: "status" });
      const res = await app.inject({ method: "GET", url: "/memories/m_f" });
      expect(res.statusCode).toBe(404);
      expect(res.json().message).toContain("Memory 不存在");
    });
  });

  describe("PATCH /memories/:id", () => {
    it("非法 type → schema 拒绝，不触发 get", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "PATCH",
        url: "/memories/m_1",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ type: "oops" }),
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(memoryApi.get).not.toHaveBeenCalled();
    });

    it("本人记忆 → 走 update(id, userId, body) 并返回合并结果", async () => {
      const app = await buildApp();
      seed({ id: "m_1", userId: "user_a", content: "原内容", type: "status", pinned: false });
      const res = await app.inject({
        method: "PATCH",
        url: "/memories/m_1",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ pinned: true }),
      });
      expect(res.statusCode).toBe(200);
      expect(memoryApi.get).toHaveBeenCalledWith("m_1", "user_a");
      expect(memoryApi.update).toHaveBeenCalledWith("m_1", "user_a", { pinned: true });
      expect(res.json().pinned).toBe(true);
    });

    it("他人记忆 → 404，不进 update", async () => {
      const app = await buildApp();
      seed({ id: "m_f", userId: "user_b", content: "私密", type: "status" });
      const res = await app.inject({
        method: "PATCH",
        url: "/memories/m_f",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ pinned: true }),
      });
      expect(res.statusCode).toBe(404);
      expect(memoryApi.update).not.toHaveBeenCalled();
    });
  });

  describe("POST /memories", () => {
    it("合法创建（无 projectId）→ write 收到 userId/type/content，返回 200", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/memories",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ content: "记一下", type: "decision" }),
      });
      expect(res.statusCode).toBe(200);
      expect(memoryApi.write).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "user_a", type: "decision", content: "记一下", projectId: null }),
      );
      expect(res.json().id).toBe("m_created");
    });

    it("content 为空 → 拒绝且不 write", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/memories",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ content: "", type: "status" }),
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(memoryApi.write).not.toHaveBeenCalled();
    });
  });

  describe("DELETE /memories/:id", () => {
    it("本人 → ok，delete 被调", async () => {
      const app = await buildApp();
      seed({ id: "m_1", userId: "user_a", content: "x", type: "task" });
      const res = await app.inject({ method: "DELETE", url: "/memories/m_1" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
      expect(memoryApi.delete).toHaveBeenCalledWith("m_1", "user_a");
    });

    it("他人 → 404，delete 不被调", async () => {
      const app = await buildApp();
      seed({ id: "m_f", userId: "user_b", content: "x", type: "task" });
      const res = await app.inject({ method: "DELETE", url: "/memories/m_f" });
      expect(res.statusCode).toBe(404);
      expect(memoryApi.delete).not.toHaveBeenCalled();
    });
  });
});
