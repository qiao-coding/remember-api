import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import {
  assertCustomSecret,
  generateApiKey,
  hashApiKey,
  maskApiKey,
  newId,
} from "@remember/shared";
import { apiKeys, getDb, profiles } from "@remember/db";
import { env } from "../../env.js";
import { httpError } from "../../lib/http-error.js";

/**
 * profileId: 必填 —— 每个 key 强制绑定一个个人 model（子 agent），只能聊它一个，不再有"全量通用 key"。
 * secret: 可选用户自定义明文（如 sk-123456）；不传则服务端生成 rma_ 随机 key。
 */
export const CreateKeySchema = z.object({
  name: z.string().min(1),
  profileId: z.string().min(1),
  secret: z.string().min(8).optional(),
});
export const KeyPatchSchema = z
  .object({
    disabled: z.boolean().optional(),
    profileId: z.string().min(1).optional(),
  })
  .refine(
    (d) => d.disabled !== undefined || d.profileId !== undefined,
    { message: "至少提供 disabled 或 profileId" },
  )
  .refine((d) => d.profileId !== "", { message: "profileId 不能为空字符串" });

function toView(row: typeof apiKeys.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    profileId: row.profileId,
    prefix: row.prefix,
    last4: row.last4,
    disabled: row.disabled,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

async function assertProfileOwned(profileId: string, userId: string) {
  const row = (
    await getDb()
      .select({ id: profiles.id, projectId: profiles.projectId })
      .from(profiles)
      .where(and(eq(profiles.id, profileId), eq(profiles.userId, userId)))
      .limit(1)
  )[0];
  if (!row) throw httpError(400, "Profile 不存在或不属于当前用户");
  if (!row.projectId) throw httpError(400, "该个人 model 未绑定项目，无法绑定 key");
}

export async function managerKeysRoutes(app: FastifyInstance) {
  // 列表（不含 hash）
  app.get("/keys", async (req) => {
    const rows = await getDb()
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.userId, req.admin!.userId))
      .orderBy(desc(apiKeys.createdAt));
    return rows.map(toView);
  });

  // 创建 —— 明文 Key 仅此一次返回
  app.post("/keys", async (req, reply) => {
    const { name, profileId, secret } = CreateKeySchema.parse(req.body);
    const userId = req.admin!.userId;
    await assertProfileOwned(profileId, userId);

    const plain = secret ? assertCustomSecret(secret) : generateApiKey();
    const { prefix, last4 } = maskApiKey(plain);
    const id = newId("key");
    try {
      await getDb().insert(apiKeys).values({
        id,
        userId,
        profileId,
        name,
        prefix,
        last4,
        hash: hashApiKey(plain, env.API_KEY_PEPPER),
      });
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        // hash 唯一冲突 —— 自定义 secret 与已有 key 撞了
        throw httpError(409, "该 Key 明文已被使用，换一个自定义 secret");
      }
      throw err;
    }
    void reply;
    return {
      id,
      name,
      profileId,
      key: plain, // 仅显示一次
      prefix,
      last4,
    };
  });

  // 禁用/启用 / 换绑（仅换绑到别的个人 model，不允许解绑成 null）
  app.patch("/keys/:id", async (req) => {
    const id = (req.params as { id: string }).id;
    const body = KeyPatchSchema.parse(req.body);
    const userId = req.admin!.userId;
    if (body.profileId !== undefined) {
      await assertProfileOwned(body.profileId, userId);
    }
    const patch: Record<string, unknown> = {};
    if (body.disabled !== undefined) patch.disabled = body.disabled;
    if (body.profileId !== undefined) patch.profileId = body.profileId;

    const rows = await getDb()
      .update(apiKeys)
      .set(patch)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
      .returning({ id: apiKeys.id });
    if (!rows.length) throw httpError(404, "API Key 不存在");
    return { ok: true };
  });

  // 删除
  app.delete("/keys/:id", async (req) => {
    const id = (req.params as { id: string }).id;
    const rows = await getDb()
      .delete(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, req.admin!.userId)))
      .returning({ id: apiKeys.id });
    if (!rows.length) throw httpError(404, "API Key 不存在");
    return { ok: true };
  });
}
