import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    // 迁移/DDL 走直连（Supabase 事务池跑不了 DDL/advisory lock），运行时才用 DATABASE_URL
    url:
      process.env.MIGRATE_DATABASE_URL ??
      process.env.DATABASE_URL ??
      "postgres://postgres:postgres@localhost:5432/remember_api",
  },
  strict: true,
  verbose: true,
});
