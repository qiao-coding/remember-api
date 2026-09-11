import { describe, expect, it } from "vitest";
import { EnvSchema } from "./env.js";

/**
 * 上游凭据默认值的锚点测试。
 *
 * 用 schema 直接 parse 一个最小对象，而不是 import env 后读 process.env：
 * env.ts 在 import 期会 process.loadEnvFile()，那样测出来的是「本机 .env 长什么样」。
 */
const parsed = EnvSchema.parse({ DATABASE_URL: "postgres://x" });

describe("上游 provider 配置默认值", () => {
  it("UPSTREAM_BASE_URL 默认空 —— 非空会把所有 provider 短路到同一家", () => {
    expect(parsed.UPSTREAM_BASE_URL).toBe("");
  });

  it("UPSTREAM_API_KEY 默认空（无 key 时网关走 Mock Provider）", () => {
    expect(parsed.UPSTREAM_API_KEY).toBe("");
  });

  it("归档提炼默认仍是 deepseek / deepseek-chat", () => {
    expect(parsed.ARCHIVE_PROVIDER).toBe("deepseek");
    expect(parsed.ARCHIVE_MODEL).toBe("deepseek-chat");
  });

  it("显式给值时不覆盖、不丢失", () => {
    const custom = EnvSchema.parse({
      DATABASE_URL: "postgres://x",
      UPSTREAM_API_KEY: "sk-other",
      UPSTREAM_BASE_URL: "https://openrouter.ai/api/v1",
      ARCHIVE_PROVIDER: "openrouter",
      ARCHIVE_MODEL: "qwen/qwen3-32b",
    });
    expect(custom.UPSTREAM_API_KEY).toBe("sk-other");
    expect(custom.UPSTREAM_BASE_URL).toBe("https://openrouter.ai/api/v1");
    expect(custom.ARCHIVE_PROVIDER).toBe("openrouter");
    expect(custom.ARCHIVE_MODEL).toBe("qwen/qwen3-32b");
  });
});
