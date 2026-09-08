import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { newId, PROVIDER_IDS } from "@remember/shared";
import { getDb, providerConfigs } from "@remember/db";
import { env } from "../../env.js";
import { encryptSecret } from "../../lib/crypto.js";
import { httpError } from "../../lib/http-error.js";

export const ProviderSchema = z.object({
  provider: z.enum(PROVIDER_IDS as [string, ...string[]]),
  baseUrl: z.string().nullable().optional(),
  defaultModel: z.string().nullable().optional(),
  /** 明文 Provider Key，仅创建/更新时提交 */
  apiKey: z.string().min(1).optional(),
});

function toView(row: typeof providerConfigs.$inferSelect) {
  return {
    id: row.id,
    provider: row.provider,
    baseUrl: row.baseUrl,
    defaultModel: row.defaultModel,
    isConnected: row.isConnected,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function managerProvidersRoutes(app: FastifyInstance) {
  app.get("/providers", async (req) => {
    const rows = await getDb()
      .select()
      .from(providerConfigs)
      .where(eq(providerConfigs.userId, req.admin!.userId));
    return rows.map(toView);
  });

  // 创建/更新（upsert）：新 Key 加密存储
  app.post("/providers", async (req) => {
    const body = ProviderSchema.parse(req.body);
    const userId = req.admin!.userId;

    const existing = (
      await getDb()
        .select()
        .from(providerConfigs)
        .where(
          and(
            eq(providerConfigs.userId, userId),
            eq(providerConfigs.provider, body.provider),
          ),
        )
        .limit(1)
    )[0];

    const values = {
      baseUrl: body.baseUrl ?? null,
      defaultModel: body.defaultModel ?? null,
      apiKeyEncrypted: body.apiKey
        ? encryptSecret(body.apiKey, env.ENCRYPTION_KEY)
        : existing?.apiKeyEncrypted ?? null,
      isConnected: Boolean(body.apiKey) || Boolean(existing?.apiKeyEncrypted),
    };

    if (existing) {
      await getDb()
        .update(providerConfigs)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(providerConfigs.id, existing.id));
      return { id: existing.id };
    }

    const id = newId("prov");
    await getDb().insert(providerConfigs).values({
      id,
      userId,
      provider: body.provider,
      ...values,
    });
    return { id };
  });

  app.patch("/providers/:id", async (req) => {
    const id = (req.params as { id: string }).id;
    const body = ProviderSchema.partial().parse(req.body);
    const existing = (
      await getDb()
        .select()
        .from(providerConfigs)
        .where(and(eq(providerConfigs.id, id), eq(providerConfigs.userId, req.admin!.userId)))
        .limit(1)
    )[0];
    if (!existing) throw httpError(404, "Provider 配置不存在");

    const values: Record<string, unknown> = {
      ...(body.baseUrl !== undefined && { baseUrl: body.baseUrl }),
      ...(body.defaultModel !== undefined && { defaultModel: body.defaultModel }),
      ...(body.provider !== undefined && { provider: body.provider }),
    };
    if (body.apiKey) {
      values.apiKeyEncrypted = encryptSecret(body.apiKey, env.ENCRYPTION_KEY);
      values.isConnected = true;
    }
    await getDb()
      .update(providerConfigs)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(providerConfigs.id, id));
    return { ok: true };
  });

  app.delete("/providers/:id", async (req) => {
    const id = (req.params as { id: string }).id;
    const rows = await getDb()
      .delete(providerConfigs)
      .where(and(eq(providerConfigs.id, id), eq(providerConfigs.userId, req.admin!.userId)))
      .returning({ id: providerConfigs.id });
    if (!rows.length) throw httpError(404, "Provider 配置不存在");
    return { ok: true };
  });
}
