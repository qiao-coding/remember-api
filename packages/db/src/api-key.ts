import { hashApiKey, maskApiKey, newId } from "@remember/shared";
import { eq } from "drizzle-orm";
import { getDb, type Db } from "./client.js";
import { apiKeys } from "./schema.js";

export type ApiKeyRow = typeof apiKeys.$inferSelect;

export interface CreateApiKeyInput {
  userId: string;
  /** 必填：key 只能调用绑定它的那一个 Profile（子 agent），不允许 user 级万能 key */
  profileId: string;
  name: string;
  /** 明文；只在创建时存在，库里只有哈希 */
  plaintext: string;
  /** 与网关运行时必须同一个，否则每个请求都 401 */
  pepper: string;
}

/** 该用户所有 Key（不含哈希；展示用） */
export async function listApiKeys(userId: string): Promise<ApiKeyRow[]> {
  return getDb()
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .orderBy(apiKeys.createdAt);
}

/**
 * 建一把 Key。哈希在这里算，调用方拿不到「忘记 pepper」的机会。
 * 同一明文重复插入会命中 `api_keys_hash_idx`，用 onConflictDoNothing 保持幂等。
 */
export async function createApiKey(input: CreateApiKeyInput): Promise<{ id: string }> {
  const id = newId("key");
  const { prefix, last4 } = maskApiKey(input.plaintext);
  await getDb()
    .insert(apiKeys)
    .values({
      id,
      userId: input.userId,
      profileId: input.profileId,
      name: input.name,
      prefix,
      last4,
      hash: hashApiKey(input.plaintext, input.pepper),
    })
    .onConflictDoNothing({ target: apiKeys.hash });
  return { id };
}
