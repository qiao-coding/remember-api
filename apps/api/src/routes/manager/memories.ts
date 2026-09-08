import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { createMemoryProvider, type MemoryProvider } from "@remember/memory";
import { getDb, projects } from "@remember/db";
import { env } from "../../env.js";
import { httpError } from "../../lib/http-error.js";

const MEMORY_TYPES = [
  "preference",
  "decision",
  "status",
  "task",
  "issue",
  "history",
] as const;

export const MemoryPatchSchema = z.object({
  content: z.string().min(1).optional(),
  type: z.enum(MEMORY_TYPES).optional(),
  importance: z.number().min(0).max(1).optional(),
  pinned: z.boolean().optional(),
  projectId: z.string().nullable().optional(),
});

export const MemoryCreateSchema = z.object({
  content: z.string().min(1),
  type: z.enum(MEMORY_TYPES),
  importance: z.number().min(0).max(1).optional(),
  pinned: z.boolean().optional(),
  projectId: z.string().nullable().optional(),
});

function provider(): MemoryProvider {
  return createMemoryProvider(
    env.MEM0_BASE_URL
      ? { baseUrl: env.MEM0_BASE_URL, apiKey: env.MEM0_API_KEY }
      : undefined,
  );
}

async function assertProjectBelongsToUser(projectId: string | null | undefined, userId: string) {
  if (!projectId) return;
  const row = (
    await getDb()
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
      .limit(1)
  )[0];
  if (!row) throw httpError(400, "Project 不存在");
}

export async function managerMemoriesRoutes(app: FastifyInstance) {
  app.get("/memories", async (req) => {
    const q = req.query as {
      q?: string;
      projectId?: string;
      type?: string;
      pinnedOnly?: string;
      limit?: string;
      offset?: string;
    };
    const mp = provider();
    const projectId =
      q.projectId === "__global__"
        ? null
        : q.projectId
          ? q.projectId
          : undefined;

    if (q.q) {
      let rows = await mp.search({
        userId: req.admin!.userId,
        projectId,
        query: q.q,
        limit: Number(q.limit ?? 50),
      });
      if (q.type) rows = rows.filter((m) => m.type === q.type);
      if (q.pinnedOnly === "true") rows = rows.filter((m) => m.pinned);
      return rows;
    }

    return mp.list({
      userId: req.admin!.userId,
      projectId,
      type: (q.type as (typeof MEMORY_TYPES)[number]) ?? null,
      pinnedOnly: q.pinnedOnly === "true",
      limit: Number(q.limit ?? 50),
      offset: Number(q.offset ?? 0),
    });
  });

  app.post("/memories", async (req) => {
    const body = MemoryCreateSchema.parse(req.body);
    await assertProjectBelongsToUser(body.projectId, req.admin!.userId);
    return provider().write({
      userId: req.admin!.userId,
      projectId: body.projectId ?? null,
      type: body.type,
      content: body.content,
      importance: body.importance ?? 0.5,
      pinned: body.pinned ?? false,
      source: "user",
    });
  });

  app.get("/memories/:id", async (req) => {
    const id = (req.params as { id: string }).id;
    const mem = await provider().get(id, req.admin!.userId);
    if (!mem) throw httpError(404, "Memory 不存在");
    return mem;
  });

  app.patch("/memories/:id", async (req) => {
    const id = (req.params as { id: string }).id;
    const body = MemoryPatchSchema.parse(req.body);
    // 先做归属校验：不存在或不属于当前用户 → 404（update 内部会再 get 一次，属冗余但保证 404 语义）
    const existing = await provider().get(id, req.admin!.userId);
    if (!existing) throw httpError(404, "Memory 不存在");
    await assertProjectBelongsToUser(body.projectId, req.admin!.userId);
    const mem = await provider().update(id, req.admin!.userId, body);
    return mem;
  });

  app.delete("/memories/:id", async (req) => {
    const id = (req.params as { id: string }).id;
    const mem = await provider().get(id, req.admin!.userId);
    if (!mem) throw httpError(404, "Memory 不存在");
    await provider().delete(id, req.admin!.userId);
    return { ok: true };
  });
}
