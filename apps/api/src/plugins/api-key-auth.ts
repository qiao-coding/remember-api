import type { FastifyReply, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { hashApiKey } from "@remember/shared";
import { apiKeys, getDb } from "@remember/db";
import { env } from "../env.js";

/** /v1 网关鉴权：Authorization: Bearer rma_xxx → 解析用户 */
export async function apiKeyAuthHook(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply | undefined> {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    return reply.code(401).send({
      error: { message: "缺少 API Key", type: "auth_error", code: "invalid_api_key", param: null },
    });
  }

  const hash = hashApiKey(token, env.API_KEY_PEPPER);
  const row = await getDb().query.apiKeys.findFirst({
    where: eq(apiKeys.hash, hash),
  });
  if (!row || row.disabled) {
    return reply.code(401).send({
      error: {
        message: "API Key 无效或已禁用",
        type: "auth_error",
        code: "invalid_api_key",
        param: null,
      },
    });
  }

  // 强制隔离：每个 key 必须绑定一个个人 model。防御性拦截未绑定（理论上 DB 已 NOT NULL 不会出现）。
  if (!row.profileId) {
    return reply.code(401).send({
      error: {
        message: "该 API Key 未绑定个人 model，已失效",
        type: "auth_error",
        code: "invalid_api_key",
        param: null,
      },
    });
  }

  // 更新最后调用时间（不阻塞请求）
  void getDb()
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.id));

  req.user = { id: row.userId, apiKeyId: row.id, keyProfileId: row.profileId };
}
