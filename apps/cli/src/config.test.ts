import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CONFIG_VERSION,
  configPath,
  configToEnv,
  emptyConfig,
  generateSecret,
  readConfig,
  writeConfig,
} from "./config.js";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "remember-api-config-"));
  process.env.REMEMBER_API_HOME = home;
});

afterEach(async () => {
  delete process.env.REMEMBER_API_HOME;
  await rm(home, { recursive: true, force: true });
});

describe("配置存储", () => {
  it("没 init 过 → readConfig 返回 null（不是抛错）", async () => {
    expect(await readConfig()).toBeNull();
  });

  it("写入后能原样读回，且目录是自动创建的", async () => {
    const config = emptyConfig();
    config.database.url = "postgres://localhost:5432/remember_api";
    await writeConfig(config);
    const back = await readConfig();
    expect(back).not.toBeNull();
    expect(back?.database.url).toBe("postgres://localhost:5432/remember_api");
    expect(back?.secrets.apiKeyPepper).toBe(config.secrets.apiKeyPepper);
    expect(back?.version).toBe(CONFIG_VERSION);
  });

  it("文件是合法 JSON（人可读，便于排障）", async () => {
    await writeConfig(emptyConfig());
    const raw = await readFile(configPath(), "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(JSON.parse(raw).version).toBe(CONFIG_VERSION);
  });

  it("文件被手工改坏 → 报错里带上路径与修复建议（不是裸 SyntaxError）", async () => {
    await writeConfig(emptyConfig());
    await writeFile(configPath(), "{ this is not json", "utf8");
    await expect(readConfig()).rejects.toThrow(/不是合法 JSON.*remember-api init/s);
  });

  it("generateSecret 每次不同、64 位 hex（不依赖 openssl）", () => {
    const a = generateSecret();
    const b = generateSecret();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it("emptyConfig 带上服务默认值与固定本地用户", () => {
    const c = emptyConfig();
    expect(c.server).toEqual({ host: "127.0.0.1", port: 4000 });
    expect(c.user.id).toBe("usr_local_admin");
    expect(c.selection).toBeNull();
    expect(c.apiKey).toBeNull();
  });
});

describe("configToEnv", () => {
  it("映射 DB 与两个密钥，并把 SUPABASE_* 关掉（网关-only 模式）", () => {
    const config = emptyConfig();
    config.database.url = "postgres://u:p@127.0.0.1:5432/remember_api";
    const env = configToEnv(config);
    expect(env.DATABASE_URL).toBe("postgres://u:p@127.0.0.1:5432/remember_api");
    expect(env.API_KEY_PEPPER).toBe(config.secrets.apiKeyPepper);
    expect(env.ENCRYPTION_KEY).toBe(config.secrets.encryptionKey);
    expect(env.SUPABASE_URL).toBe("");
    expect(env.PORT).toBe("4000");
  });

  it("显式清空 UPSTREAM_API_KEY —— 否则开发机上残留的 env Key 会悄悄接管出站凭据", () => {
    // 这条是承重的：本地模式一律走 provider_configs，env 兜底必须是空的。
    // env.ts 的 process.loadEnvFile() 会读 <cwd>/.env 且不覆盖已有变量，
    // 显式传空串是唯一能压住它的手段。
    const env = configToEnv(emptyConfig());
    expect(env).toHaveProperty("UPSTREAM_API_KEY", "");
    expect(env).toHaveProperty("UPSTREAM_BASE_URL", "");
  });

  it("归档/摘要跟着选中的厂商走（不设 = 别把模型名发到别家端点）", () => {
    const config = emptyConfig();
    const without = configToEnv(config);
    expect(without).not.toHaveProperty("ARCHIVE_PROVIDER");

    config.selection = {
      provider: "moonshotai",
      model: "kimi-k2",
      baseUrl: "https://api.moonshot.cn/v1",
    };
    const withSel = configToEnv(config);
    expect(withSel.ARCHIVE_PROVIDER).toBe("moonshotai");
    expect(withSel.ARCHIVE_MODEL).toBe("kimi-k2");
  });

  it("migrateUrl 只在真的不同于运行时地址时才出现", () => {
    const config = emptyConfig();
    expect(configToEnv(config)).not.toHaveProperty("MIGRATE_DATABASE_URL");
    config.database.migrateUrl = "postgres://postgres@127.0.0.1:5432/postgres";
    expect(configToEnv(config).MIGRATE_DATABASE_URL).toBe(
      "postgres://postgres@127.0.0.1:5432/postgres",
    );
  });
});
