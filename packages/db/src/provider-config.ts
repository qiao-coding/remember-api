import { and, eq, isNotNull } from "drizzle-orm";
import { decryptSecret, encryptSecret, newId } from "@remember/shared";
import { getDb } from "./client.js";
import { providerConfigs } from "./schema.js";

/**
 * provider_configs 的唯一存取入口。
 *
 * 为什么放在 db 包而不是路由里：Web 控制台（`/api/providers`）与 CLI 都要写这张表，
 * 两份「查 → 加密 → upsert」实现迟早漂移，而漂移的后果是 CLI 写的密文网关读不对。
 *
 * 这里的行同时是**模型调用路径**的凭据来源（见 `apps/api/src/lib/upstream.ts`），
 * 不再只是控制台里的展示数据。
 */

export type ProviderConfigRow = typeof providerConfigs.$inferSelect;

/** 该用户所有 provider 配置（本地单用户场景通常只有几行） */
export async function listProviderConfigs(userId: string): Promise<ProviderConfigRow[]> {
  return (await getDb().query.providerConfigs.findMany({
    where: eq(providerConfigs.userId, userId),
  })) ?? [];
}

/** 单条查询；不存在返回 null */
export async function findProviderConfig(
  userId: string,
  provider: string,
): Promise<ProviderConfigRow | null> {
  return (
    (await getDb().query.providerConfigs.findFirst({
      where: and(eq(providerConfigs.userId, userId), eq(providerConfigs.provider, provider)),
    })) ?? null
  );
}

/**
 * 启动自检用：库里**任意**用户是否已录入过 Key（跨用户，只回答「这库到底配没配过」）。
 * 与 `listProviderConfigs` 的区别是它不看 user，因此不能用于请求期鉴权。
 */
export async function hasAnyProviderCredential(): Promise<boolean> {
  const row = await getDb().query.providerConfigs.findFirst({
    where: isNotNull(providerConfigs.apiKeyEncrypted),
    columns: { id: true },
  });
  return Boolean(row);
}

/**
 * 解密某个 provider 配置里的 Key。
 *
 * 解密失败一律**抛错**而非返回空：`ENCRYPTION_KEY` 被换过时，静默降级会让用户
 * 以为自己在用新 Key、实际在用别的凭据。
 */
export function readProviderKey(row: ProviderConfigRow, encryptionKey: string): string | null {
  if (!row.apiKeyEncrypted) return null;
  try {
    return decryptSecret(row.apiKeyEncrypted, encryptionKey);
  } catch (err) {
    throw new Error(
      `provider「${row.provider}」的 API Key 解密失败（通常意味着 ENCRYPTION_KEY 被换过）。` +
        `请在控制台或 CLI 重新录入该 Key。原始错误：${(err as Error).message}`,
    );
  }
}

export interface UpsertProviderConfigInput {
  userId: string;
  provider: string;
  /** 用于加密新提交的明文 Key（对应 env.ENCRYPTION_KEY） */
  encryptionKey: string;
  /** 不传 = 保留现有值；传 null = 显式清空 */
  baseUrl?: string | null;
  defaultModel?: string | null;
  /** 明文 Key；不传 = 保留现有密文 */
  apiKey?: string;
}

/**
 * 创建或更新（每 user 每 provider 唯一）。返回该行 id。
 * `apiKey` 不传时保留旧密文 —— 这是「Key 填一次」的基础。
 */
export async function upsertProviderConfig(
  input: UpsertProviderConfigInput,
): Promise<{ id: string }> {
  const existing = await findProviderConfig(input.userId, input.provider);

  const baseUrl = input.baseUrl === undefined ? (existing?.baseUrl ?? null) : input.baseUrl;
  const defaultModel =
    input.defaultModel === undefined ? (existing?.defaultModel ?? null) : input.defaultModel;
  const apiKeyEncrypted = input.apiKey
    ? encryptSecret(input.apiKey, input.encryptionKey)
    : (existing?.apiKeyEncrypted ?? null);

  const values = {
    baseUrl,
    defaultModel,
    apiKeyEncrypted,
    isConnected: Boolean(apiKeyEncrypted),
    updatedAt: new Date(),
  };

  if (existing) {
    await getDb()
      .update(providerConfigs)
      .set(values)
      .where(eq(providerConfigs.id, existing.id));
    return { id: existing.id };
  }

  const id = newId("prov");
  await getDb()
    .insert(providerConfigs)
    .values({ id, userId: input.userId, provider: input.provider, ...values });
  return { id };
}
