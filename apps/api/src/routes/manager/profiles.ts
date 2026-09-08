import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { newId, PROVIDER_IDS } from "@remember/shared";
import { getDb, profiles, projects } from "@remember/db";
import { httpError } from "../../lib/http-error.js";

export const ProfileSchema = z.object({
  name: z.string().min(1),
  provider: z.enum(PROVIDER_IDS as [string, ...string[]]),
  model: z.string().min(1),
  projectId: z.string().min(1),
  systemPrompt: z.string().nullable().optional(),
  memoryEnabled: z.boolean().optional().default(true),
  memoryBudget: z.number().int().min(100).max(100000).optional(),
  skillIds: z.array(z.string()).optional(),
  temperature: z.number().nullable().optional(),
  maxTokens: z.number().int().nullable().optional(),
});

function toView(row: typeof profiles.$inferSelect, projectName?: string | null) {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    model: row.model,
    projectId: row.projectId,
    projectName: projectName ?? null,
    systemPrompt: row.systemPrompt,
    memoryEnabled: row.memoryEnabled,
    memoryBudget: row.memoryBudget,
    skillIds: row.skillIds,
    temperature: row.temperature,
    maxTokens: row.maxTokens,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function assertProjectBelongsToUser(projectId: string, userId: string) {
  const row = (
    await getDb()
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
      .limit(1)
  )[0];
  if (!row) throw httpError(400, "Project 不存在");
}

export async function managerProfilesRoutes(app: FastifyInstance) {
  app.get("/profiles", async (req) => {
    const rows = await getDb().query.profiles.findMany({
      where: eq(profiles.userId, req.admin!.userId),
      with: { project: true },
    });
    return rows.map((r) => toView(r, r.project?.name));
  });

  app.get("/profiles/:id", async (req) => {
    const id = (req.params as { id: string }).id;
    const row = (
      await getDb()
        .select()
        .from(profiles)
        .where(and(eq(profiles.id, id), eq(profiles.userId, req.admin!.userId)))
        .limit(1)
    )[0];
    if (!row) throw httpError(404, "Profile 不存在");
    const project = row.projectId
      ? (
          await getDb()
            .select({ name: projects.name })
            .from(projects)
            .where(eq(projects.id, row.projectId))
            .limit(1)
        )[0]
      : null;
    return toView(row, project?.name);
  });

  app.post("/profiles", async (req) => {
    const body = ProfileSchema.parse(req.body);
    await assertProjectBelongsToUser(body.projectId, req.admin!.userId);
    const id = newId("prof");
    await getDb().insert(profiles).values({
      id,
      userId: req.admin!.userId,
      name: body.name,
      provider: body.provider,
      model: body.model,
      projectId: body.projectId,
      systemPrompt: body.systemPrompt ?? null,
      memoryEnabled: body.memoryEnabled ?? true,
      memoryBudget: body.memoryBudget ?? 1500,
      skillIds: body.skillIds ?? [],
      temperature: body.temperature ?? null,
      maxTokens: body.maxTokens ?? null,
    });
    return { id };
  });

  app.patch("/profiles/:id", async (req) => {
    const id = (req.params as { id: string }).id;
    const body = ProfileSchema.partial().parse(req.body);
    const existing = (
      await getDb()
        .select()
        .from(profiles)
        .where(and(eq(profiles.id, id), eq(profiles.userId, req.admin!.userId)))
        .limit(1)
    )[0];
    if (!existing) throw httpError(404, "Profile 不存在");
    if (body.projectId !== undefined) {
      await assertProjectBelongsToUser(body.projectId, req.admin!.userId);
    }
    await getDb()
      .update(profiles)
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.provider !== undefined && { provider: body.provider }),
        ...(body.model !== undefined && { model: body.model }),
        ...(body.projectId !== undefined && { projectId: body.projectId }),
        ...(body.systemPrompt !== undefined && { systemPrompt: body.systemPrompt }),
        ...(body.memoryEnabled !== undefined && { memoryEnabled: body.memoryEnabled }),
        ...(body.memoryBudget !== undefined && { memoryBudget: body.memoryBudget }),
        ...(body.skillIds !== undefined && { skillIds: body.skillIds }),
        ...(body.temperature !== undefined && { temperature: body.temperature }),
        ...(body.maxTokens !== undefined && { maxTokens: body.maxTokens }),
        updatedAt: new Date(),
      })
      .where(eq(profiles.id, id));
    return { ok: true };
  });

  app.delete("/profiles/:id", async (req) => {
    const id = (req.params as { id: string }).id;
    const rows = await getDb()
      .delete(profiles)
      .where(and(eq(profiles.id, id), eq(profiles.userId, req.admin!.userId)))
      .returning({ id: profiles.id });
    if (!rows.length) throw httpError(404, "Profile 不存在");
    return { ok: true };
  });
}
