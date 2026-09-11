/**
 * CLI 配置存储 —— `~/.remember-api/config.json`。
 *
 * 这里只存**这台机器的部署事实**（DB 地址、两个密钥、默认选择）。用户录入的各家
 * Provider Key 不在这里：它们加密存在 `provider_configs` 表里，由 CLI 写入、网关读取。
 * 所以换 Key 不需要动这个文件，也不需要重启。
 */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const CONFIG_VERSION = 1;

/** 本地单用户模式的固定身份（与 install/local.mdx 的 usr_local_admin 对齐） */
export const LOCAL_USER = {
  id: "usr_local_admin",
  email: "admin@remember.local",
  name: "Admin",
} as const;

export const DEFAULT_PROFILE_NAME = "remember-dev";

export interface Selection {
  provider: string;
  model: string;
  /** 出站端点；来自模型目录的 provider.api */
  baseUrl: string | null;
}

export interface CliConfig {
  version: number;
  database: {
    url: string;
    /** 迁移/建表用的地址（Supabase 上必须是 session 池 5432）；null = 与 url 相同 */
    migrateUrl: string | null;
    docker: { container: string; image: string; port: number; managed: boolean } | null;
  };
  secrets: {
    /** API Key 哈希用的 pepper；seed 与运行时必须是同一个，否则每个请求都 401 */
    apiKeyPepper: string;
    /** provider_configs 里 Key 的加密密钥；换了已存密文就解不开 */
    encryptionKey: string;
  };
  user: { id: string; email: string; name: string };
  /** 引导 Key：明文只在这里存一份，用于打印「三件套」 */
  apiKey: { value: string; profileName: string } | null;
  selection: Selection | null;
  server: { host: string; port: number };
}

/** 配置目录；`REMEMBER_API_HOME` 可覆盖（测试与多实例用） */
export function configHome(): string {
  return process.env.REMEMBER_API_HOME ?? join(homedir(), ".remember-api");
}

export function configPath(): string {
  return join(configHome(), "config.json");
}

/** 32 字节随机 → 64 位 hex。不依赖 openssl（Windows 上不一定有） */
export function generateSecret(): string {
  return randomBytes(32).toString("hex");
}

export async function readConfig(): Promise<CliConfig | null> {
  let raw: string;
  try {
    raw = await readFile(configPath(), "utf8");
  } catch {
    return null; // 不存在 = 还没 init
  }
  try {
    return JSON.parse(raw) as CliConfig;
  } catch (err) {
    throw new Error(
      `${configPath()} 不是合法 JSON（${(err as Error).message}）。` +
        `修好它，或删掉后重新运行 remember-api init。`,
    );
  }
}

/**
 * 写入配置（0600）。每次向导走完一步就调用，Ctrl-C 不会丢掉已经做完的建库/密钥工作。
 * Windows 上 mode 基本被忽略 —— 尽力而为，真正的秘密在 provider_configs 里加密存放。
 */
export async function writeConfig(config: CliConfig): Promise<void> {
  const file = configPath();
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}

export function emptyConfig(): CliConfig {
  return {
    version: CONFIG_VERSION,
    database: { url: "", migrateUrl: null, docker: null },
    secrets: { apiKeyPepper: generateSecret(), encryptionKey: generateSecret() },
    user: { ...LOCAL_USER },
    apiKey: null,
    selection: null,
    server: { host: "127.0.0.1", port: 4000 },
  };
}

/**
 * 传给网关进程的环境变量。**单一来源**：env.ts 读 `<cwd>/.env`（不覆盖已有变量），
 * 而这里显式传入的值优先，所以配置文件的优先级规则只有这一处定义。
 *
 * 刻意带 `UPSTREAM_API_KEY=""`：本地模式一律走 provider_configs，避免开发机上残留的
 * env Key 悄悄接管出站凭据。
 */
export function configToEnv(config: CliConfig): Record<string, string> {
  const env: Record<string, string> = {
    DATABASE_URL: config.database.url,
    API_KEY_PEPPER: config.secrets.apiKeyPepper,
    ENCRYPTION_KEY: config.secrets.encryptionKey,
    PORT: String(config.server.port),
    HOST: config.server.host,
    LOG_LEVEL: "info",
    // 网关-only：CLI 直接读写库，不走需要 Supabase JWT 的 /api 控制台
    SUPABASE_URL: "",
    SUPABASE_SERVICE_ROLE_KEY: "",
    UPSTREAM_API_KEY: "",
    UPSTREAM_BASE_URL: "",
  };
  if (config.database.migrateUrl) env.MIGRATE_DATABASE_URL = config.database.migrateUrl;
  if (config.selection) {
    // 归档/摘要跟着用户选的厂商走，否则会把模型名发到别家端点
    env.ARCHIVE_PROVIDER = config.selection.provider;
    env.ARCHIVE_MODEL = config.selection.model;
  }
  return env;
}
