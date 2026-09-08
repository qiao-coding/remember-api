import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { estimateTokens } from "@remember/core";
import { newId } from "@remember/shared";
import { getDb, skills } from "@remember/db";
import { httpError } from "../../lib/http-error.js";

const SkillSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  content: z.string().min(1),
});

function toView(row: typeof skills.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    content: row.content,
    tokenCount: row.tokenCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function managerSkillsRoutes(app: FastifyInstance) {
  app.get("/skills", async (req) => {
    const rows = await getDb()
      .select()
      .from(skills)
      .where(eq(skills.userId, req.admin!.userId));
    return rows.map(toView);
  });

  app.get("/skills/:id", async (req) => {
    const id = (req.params as { id: string }).id;
    const row = (
      await getDb()
        .select()
        .from(skills)
        .where(and(eq(skills.id, id), eq(skills.userId, req.admin!.userId)))
        .limit(1)
    )[0];
    if (!row) throw httpError(404, "Skill 不存在");
    return toView(row);
  });

  app.post("/skills", async (req) => {
    const body = SkillSchema.parse(req.body);
    const id = newId("skill");
    await getDb().insert(skills).values({
      id,
      userId: req.admin!.userId,
      name: body.name,
      description: body.description ?? null,
      content: body.content,
      tokenCount: estimateTokens(body.content),
    });
    return { id };
  });

  app.patch("/skills/:id", async (req) => {
    const id = (req.params as { id: string }).id;
    const body = SkillSchema.partial().parse(req.body);
    const existing = (
      await getDb()
        .select()
        .from(skills)
        .where(and(eq(skills.id, id), eq(skills.userId, req.admin!.userId)))
        .limit(1)
    )[0];
    if (!existing) throw httpError(404, "Skill 不存在");
    await getDb()
      .update(skills)
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.content !== undefined && {
          content: body.content,
          tokenCount: estimateTokens(body.content),
        }),
        updatedAt: new Date(),
      })
      .where(eq(skills.id, id));
    return { ok: true };
  });

  app.delete("/skills/:id", async (req) => {
    const id = (req.params as { id: string }).id;
    const rows = await getDb()
      .delete(skills)
      .where(and(eq(skills.id, id), eq(skills.userId, req.admin!.userId)))
      .returning({ id: skills.id });
    if (!rows.length) throw httpError(404, "Skill 不存在");
    return { ok: true };
  });
}
