/**
 * 程序化迁移：复用 client.ts 的 SSL/CA 处理（drizzle-kit migrate 不好配 Supabase 私有 CA）。
 * 走 MIGRATE_DATABASE_URL（session pooler / 直连），DDL 必须用可跑事务的连接。
 *
 * 用法：MIGRATE_DATABASE_URL=<url> pnpm migrate
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./index.js";

function getMigrateUrl(): string {
  const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error("❌ MIGRATE_DATABASE_URL 未设置");
    process.exit(1);
  }
  return url;
}
const url = getMigrateUrl();
const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");

async function main() {
  const db = createDb(url);
  await migrate(db, { migrationsFolder });
  console.log("✅ 迁移完成");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ 迁移失败:", err.message);
    process.exit(1);
  });
