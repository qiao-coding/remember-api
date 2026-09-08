import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { getDb, users } from "@remember/db";
import { httpError } from "../../lib/http-error.js";

export async function managerAuthRoutes(app: FastifyInstance) {
  // 登录改由 Supabase Auth 处理（Web 端 signInWithPassword 直达 GoTrue），此处仅提供用户信息
  app.get("/auth/me", async (req) => {
    const row = (
      await getDb().select().from(users).where(eq(users.id, req.admin!.userId)).limit(1)
    )[0];
    if (!row) throw httpError(404, "用户不存在");
    return { user: { id: row.id, email: row.email, name: row.name } };
  });
}
