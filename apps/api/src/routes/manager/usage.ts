import type { FastifyInstance } from "fastify";
import { and, desc, eq, gte } from "drizzle-orm";
import { getDb, requestUsage } from "@remember/db";
import { breakdownBy, summarizeUsage } from "../../lib/usage-stats.js";

export async function managerUsageRoutes(app: FastifyInstance) {
  // 总览统计：?days=1|7|30
  app.get("/usage/summary", async (req) => {
    const days = Number((req.query as { days?: string }).days ?? 1);
    const since = new Date(Date.now() - days * 86400_000);
    const userId = req.admin!.userId;

    const rows = await getDb()
      .select()
      .from(requestUsage)
      .where(and(eq(requestUsage.userId, userId), gte(requestUsage.createdAt, since)));

    return summarizeUsage(rows);
  });

  // 最近请求明细
  app.get("/usage/requests", async (req) => {
    const limit = Number((req.query as { limit?: string }).limit ?? 30);
    const rows = await getDb()
      .select()
      .from(requestUsage)
      .where(eq(requestUsage.userId, req.admin!.userId))
      .orderBy(desc(requestUsage.createdAt))
      .limit(Math.min(limit, 200));
    return rows.map((r) => ({
      id: r.id,
      profileId: r.profileId,
      projectId: r.projectId,
      provider: r.provider,
      model: r.model,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      cachedTokens: r.cachedTokens,
      memoryTokens: r.memoryTokens,
      skillTokens: r.skillTokens,
      latencyMs: r.latencyMs,
      estimatedCost: r.estimatedCost,
      createdAt: r.createdAt.toISOString(),
    }));
  });

  // 按 Profile / Project 聚合（?groupBy=profile|project&days=7）
  app.get("/usage/breakdown", async (req) => {
    const q = req.query as { groupBy?: string; days?: string };
    const days = Number(q.days ?? 7);
    const since = new Date(Date.now() - days * 86400_000);
    const userId = req.admin!.userId;

    const rows = await getDb()
      .select()
      .from(requestUsage)
      .where(and(eq(requestUsage.userId, userId), gte(requestUsage.createdAt, since)));

    const groupBy = q.groupBy === "project" ? "projectId" : "profileId";
    return breakdownBy(rows, groupBy);
  });
}
