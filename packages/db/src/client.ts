import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

// Supabase 用私有根 CA（Supabase Root 2021 CA）签证书，系统信任库没有；
// 此处加载项目内已抓取的根 CA 链，保持 rejectUnauthorized: true（验证开启）
const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CA = join(HERE, "..", "certs", "supabase-ca.pem");
function loadCa(): string | undefined {
  const path = process.env.DATABASE_SSL_CA ?? DEFAULT_CA;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

export type Db = PostgresJsDatabase<typeof schema>;

/**
 * 惰性单例 —— 首次访问时才连接，避免 import 阶段因缺 DATABASE_URL 报错。
 */
let _db: Db | null = null;
let _url = "";

export function createDb(url: string): Db {
  // Supabase 强制 SSL：连接串带 sslmode=require 或显式 DATABASE_SSL=require 时开启 TLS
  // 使用 verify-full 语义（校验证书与主机名，含 Supabase 私有根 CA），不做降级
  const ssl =
    url.includes("sslmode=require") || process.env.DATABASE_SSL === "require";
  const ca = ssl ? loadCa() : undefined;
  const client = postgres(url, {
    max: 10,
    prepare: false, // postgres-js 不支持 pg 预编译，需关闭（Supabase 事务池必需）
    ...(ssl
      ? { ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) } }
      : {}),
  });
  return drizzle(client, { schema });
}

export function getDb(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  if (!_db || _url !== url) {
    _db = createDb(url);
    _url = url;
  }
  return _db;
}
