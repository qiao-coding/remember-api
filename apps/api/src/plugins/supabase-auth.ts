import type { FastifyReply, FastifyRequest } from "fastify";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { eq } from "drizzle-orm";
import { getDb, users } from "@remember/db";
import { env } from "../env.js";

/**
 * Supabase Auth JWT 鉴权（替代原 ADMIN_PASSWORD + HMAC session）。
 * - 用远程 JWKS 本地验签：首个请求拉一次 key，后续本地验签，无每请求网络开销。
 * - 校验签名 / exp / iss / aud，取 `sub` 作为用户 id。
 * - 首次登录时把 Supabase 用户同步进 public.users（外键父行），SELECT-then-INSERT 不覆盖已有姓名。
 */
const jwks = createRemoteJWKSet(
  new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
);

export async function supabaseAuthHook(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply | undefined> {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    return reply.code(401).send({ error: "未登录或会话已过期" });
  }

  let payload;
  try {
    ({ payload } = await jwtVerify(token, jwks, {
      issuer: `${env.SUPABASE_URL}/auth/v1`,
      audience: "authenticated",
    }));
  } catch {
    return reply.code(401).send({ error: "登录凭证无效或已过期" });
  }

  const userId = payload.sub;
  if (!userId) {
    return reply.code(401).send({ error: "登录凭证缺少用户标识" });
  }

  // 首次登录：确保 public.users 存在（所有租户表的外键父行）
  const existing = await getDb()
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!existing[0]) {
    const email = typeof payload.email === "string" ? payload.email : "";
    const meta = payload.user_metadata as Record<string, unknown> | undefined;
    const name =
      (typeof meta?.name === "string" && meta.name) ||
      email.split("@")[0] ||
      "User";
    await getDb()
      .insert(users)
      .values({ id: userId, email, name });
  }

  req.admin = {
    userId,
    email: typeof payload.email === "string" ? payload.email : undefined,
  };
}
