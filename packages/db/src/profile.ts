import { asc, eq } from "drizzle-orm";
import { getDb, type Db } from "./client.js";
import { profiles } from "./schema.js";

/** 该用户的 Profile（受 key 绑定与模型调用路径影响的就是它们） */
export async function listProfiles(
  userId: string,
  db: Db = getDb(),
): Promise<{ id: string; name: string; provider: string; model: string }[]> {
  return db
    .select({
      id: profiles.id,
      name: profiles.name,
      provider: profiles.provider,
      model: profiles.model,
    })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .orderBy(asc(profiles.createdAt));
}

/**
 * 把该用户所有 Profile 指向某个 provider/model。
 *
 * 「填一次 Key、之后只切模型」的落点：凭据按 provider 存在 provider_configs，
 * 模型调用路径读的是 `profiles.provider` + `profiles.model`（见 services/chat.ts），
 * 所以切模型 = 改这两列，不需要动 .env、不需要重启。
 *
 * 本地单用户模式下 Profile 通常只有一个；返回受影响行数，多于一个时由调用方提示，
 * 免得用户以为只改了手上那个。
 */
export async function setProfilesTarget(
  userId: string,
  target: { provider: string; model: string },
  db: Db = getDb(),
): Promise<number> {
  const rows = await db
    .update(profiles)
    .set({ provider: target.provider, model: target.model, updatedAt: new Date() })
    .where(eq(profiles.userId, userId))
    .returning({ id: profiles.id });
  return rows.length;
}
