import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

// Supabase 用私有根 CA（Supabase Root 2021 CA）签证书，系统信任库没有；
// 此处加载根 CA 链，保持 rejectUnauthorized: true（验证开启）
const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CA = join(HERE, "..", "certs", "supabase-ca.pem");

/**
 * 根 CA 来源，按优先级：
 *   1. `DATABASE_SSL_CA_PEM` —— 直接给 PEM **内容**。托管平台（Railway / Zeabur 等）
 *      没法挂载文件，只能走这条；`.pem` 被 gitignore 排除，从 Git 构建的镜像里也不会有。
 *   2. `DATABASE_SSL_CA` —— 给文件**路径**（compose 的 secret 挂载、本机指定别的 CA）。
 *   3. 包内 `certs/supabase-ca.pem` —— 本机开发。
 * 都拿不到就返回 undefined，交给系统信任库（连公开 CA 的 Postgres 够用）。
 */
function loadCa(): string | undefined {
  const inline = process.env.DATABASE_SSL_CA_PEM;
  if (inline?.trim()) return inline;
  const path = process.env.DATABASE_SSL_CA ?? DEFAULT_CA;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

export type Db = PostgresJsDatabase<typeof schema>;

export interface ClientOptions {
  /** 默认 10；探针/迁移这类一次性连接传 1 */
  max?: number;
  /**
   * 连接超时（**秒**）。
   * 注意选项名是 snake_case 的 `connect_timeout` —— postgres-js 不认 camelCase，
   * 写错不会报错，只会让「连不上」变成「永远连不上」（调用方在那里静止等待）。
   */
  connectTimeout?: number;
  onnotice?: () => void;
}

/**
 * 裸连接工厂 —— 需要直接发 SQL（CREATE DATABASE、`SELECT 1` 探活、迁移后 `end()`）
 * 或需要自己管生命周期的调用方走这里，SSL/根 CA 的判定与 createDb 完全一致：
 * 两套判定漂移过一次就会出现「网关连得上、CLI 探针连不上」这种鬼故事。
 */
export function createClient(url: string, opts: ClientOptions = {}) {
  // Supabase 强制 SSL：连接串带 sslmode=require 或显式 DATABASE_SSL=require 时开启 TLS
  // 使用 verify-full 语义（校验证书与主机名，含 Supabase 私有根 CA），不做降级
  const ssl =
    url.includes("sslmode=require") || process.env.DATABASE_SSL === "require";
  const ca = ssl ? loadCa() : undefined;
  return postgres(url, {
    max: opts.max ?? 10,
    prepare: false, // postgres-js 不支持 pg 预编译，需关闭（Supabase 事务池必需）
    ...(opts.connectTimeout ? { connect_timeout: opts.connectTimeout } : {}),
    ...(opts.onnotice ? { onnotice: opts.onnotice } : {}),
    ...(ssl ? { ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) } } : {}),
  });
}

/**
 * 惰性单例 —— 首次访问时才连接，避免 import 阶段因缺 DATABASE_URL 报错。
 */
let _db: Db | null = null;
let _client: ReturnType<typeof createClient> | null = null;
let _url = "";

export function createDb(url: string): Db {
  return drizzle(createClient(url), { schema });
}

export function getDb(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  if (!_db || _url !== url) {
    _client = createClient(url);
    _db = drizzle(_client, { schema });
    _url = url;
  }
  return _db;
}

/**
 * 断开单例连接池。**一次性命令（CLI 的 status/model/key/init）必须调它**：
 * 池的 keep-alive 会让事件循环一直有活干，node 进程永远不退出 —— 用户看到的是
 * 「命令跑完了、输出也打了，但光标不回来」。长驻进程（网关）不要调。
 */
export async function closeDb(): Promise<void> {
  const client = _client;
  _client = null;
  _db = null;
  _url = "";
  await client?.end();
}
