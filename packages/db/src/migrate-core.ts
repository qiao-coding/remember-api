/**
 * 迁移逻辑（可复用）——`migrate.ts` 是它的 CLI 壳，`apps/cli` 的本地向导直接调这里。
 *
 * 复用 `createClient` 而不是自己建连接：SSL/私有根 CA 的处理在 client.ts 里，
 * Supabase 与本地 Postgres 都得走同一套判定。
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createClient } from "./client.js";
import * as schema from "./schema.js";

/**
 * 跑完就断开连接池 —— 迁移是一次性动作，池 keep-alive 会把调用方的进程挂住
 * （CLI 与脚本都靠这个语义退出）。
 *
 * @param migrationsFolder `drizzle/` 目录的绝对路径；由调用方按自己的产物布局解析
 */
export async function runMigrations(
  url: string,
  migrationsFolder: string,
): Promise<void> {
  const client = createClient(url, { max: 1 });
  try {
    await migrate(drizzle(client, { schema }), { migrationsFolder });
  } finally {
    await client.end();
  }
}
