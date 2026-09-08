import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { newId } from "@remember/shared";
import { getDb, projects } from "@remember/db";
import { httpError } from "../../lib/http-error.js";

const ProjectSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  architecture: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  decisions: z.array(z.string()).optional(),
  knownIssues: z.array(z.string()).optional(),
});

function toView(row: typeof projects.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    summary: row.summary,
    architecture: row.architecture,
    status: row.status,
    decisions: row.decisions,
    knownIssues: row.knownIssues,
    memoryNamespace: row.memoryNamespace,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function managerProjectsRoutes(app: FastifyInstance) {
  app.get("/projects", async (req) => {
    const rows = await getDb()
      .select()
      .from(projects)
      .where(eq(projects.userId, req.admin!.userId))
      .orderBy(projects.updatedAt);
    return rows.map(toView);
  });

  app.get("/projects/:id", async (req) => {
    const id = (req.params as { id: string }).id;
    const row = (
      await getDb()
        .select()
        .from(projects)
        .where(and(eq(projects.id, id), eq(projects.userId, req.admin!.userId)))
        .limit(1)
    )[0];
    if (!row) throw httpError(404, "Project 不存在");
    return toView(row);
  });

  app.post("/projects", async (req) => {
    const body = ProjectSchema.parse(req.body);
    const id = newId("proj");
    await getDb().insert(projects).values({
      id,
      userId: req.admin!.userId,
      name: body.name,
      description: body.description ?? null,
      summary: body.summary ?? null,
      architecture: body.architecture ?? null,
      status: body.status ?? null,
      decisions: body.decisions ?? [],
      knownIssues: body.knownIssues ?? [],
      memoryNamespace: `ns_${id}`,
    });
    return { id };
  });

  app.patch("/projects/:id", async (req) => {
    const id = (req.params as { id: string }).id;
    const body = ProjectSchema.partial().parse(req.body);
    const existing = (
      await getDb()
        .select()
        .from(projects)
        .where(and(eq(projects.id, id), eq(projects.userId, req.admin!.userId)))
        .limit(1)
    )[0];
    if (!existing) throw httpError(404, "Project 不存在");
    await getDb()
      .update(projects)
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.summary !== undefined && { summary: body.summary }),
        ...(body.architecture !== undefined && { architecture: body.architecture }),
        ...(body.status !== undefined && { status: body.status }),
        ...(body.decisions !== undefined && { decisions: body.decisions }),
        ...(body.knownIssues !== undefined && { knownIssues: body.knownIssues }),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, id));
    return { ok: true };
  });

  app.delete("/projects/:id", async (req) => {
    const id = (req.params as { id: string }).id;
    const rows = await getDb()
      .delete(projects)
      .where(and(eq(projects.id, id), eq(projects.userId, req.admin!.userId)))
      .returning({ id: projects.id });
    if (!rows.length) throw httpError(404, "Project 不存在");
    return { ok: true };
  });
}
