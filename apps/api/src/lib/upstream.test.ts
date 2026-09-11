/**
 * upstreamProvider 凭据解析回归 —— 「Key 填一次、之后只切模型」这条体验的全部证据都在这。
 *
 * 观测方式沿用 sdk-provider.test.ts：注入 fetch 并断言**真实出站 URL + Authorization 头**，
 * 而不是断言内部变量。provider 层不做任何真实网络调用。
 *
 * 凭据助手在**包边界**替换：provider-config.ts 内部用相对 import 拿 getDb，
 * mock 包入口的 getDb 拦不住它（会去连真库）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockProvider, ProviderError } from "@remember/providers";
import { encryptSecret } from "@remember/shared";
import { resolveUpstream } from "./upstream.js";

const h = vi.hoisted(() => ({
  /** 假 provider_configs 表 */
  rows: [] as Record<string, unknown>[],
  env: {
    UPSTREAM_API_KEY: "",
    UPSTREAM_BASE_URL: "",
    ENCRYPTION_KEY: "test-encryption-key",
  },
  /** 捕获所有出站请求 */
  requests: [] as { url: string; auth: string | null }[],
}));

vi.mock("@remember/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@remember/db")>()),
  findProviderConfig: vi.fn(
    async (userId: string, provider: string) =>
      h.rows.find((r) => r.userId === userId && r.provider === provider) ?? null,
  ),
  listProviderConfigs: vi.fn(async (userId: string) =>
    h.rows.filter((r) => r.userId === userId),
  ),
}));

vi.mock("../env.js", () => ({ env: h.env }));

/** 只记录、不回真包：够上游走完一次 chat 就行 */
const fakeFetch = async (url: string, init: { headers?: Record<string, string> }) => {
  h.requests.push({ url: String(url), auth: init.headers?.authorization ?? null });
  return new Response(
    JSON.stringify({
      id: "c1",
      object: "chat.completion",
      created: 1,
      model: "whatever",
      choices: [{ index: 0, message: { role: "assistant", content: "upstream-ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
};

/** 造一行 provider_configs；明文 Key 用本测试的 ENCRYPTION_KEY 加密，模拟 CLI 写入 */
function row(
  provider: string,
  apiKey: string | null,
  baseUrl: string | null = null,
  userId = "user_a",
) {
  return {
    id: `prov_${provider}`,
    userId,
    provider,
    baseUrl,
    defaultModel: null,
    apiKeyEncrypted: apiKey ? encryptSecret(apiKey, h.env.ENCRYPTION_KEY) : null,
    isConnected: Boolean(apiKey),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/** 真打一次 chat，让出站 URL/Authorization 落到 h.requests */
async function probe(provider: string, userId = "user_a"): Promise<string> {
  const resolved = await resolveUpstream(userId, provider, {
    fetch: fakeFetch as unknown as typeof fetch,
  });
  const res = await resolved.provider.chat({
    model: "whatever-model",
    messages: [{ role: "user", content: "hi" }],
  });
  return res.content;
}

describe("resolveUpstream：凭据优先级", () => {
  beforeEach(() => {
    h.rows.length = 0;
    h.requests.length = 0;
    h.env.UPSTREAM_API_KEY = "";
    h.env.UPSTREAM_BASE_URL = "";
  });

  it("多家 provider 的行共存 → 各用自己那一把 Key 与 baseUrl（Profile 的 provider 决定用哪把）", async () => {
    h.rows.push(
      row("moonshotai", "sk-moon", "https://api.moonshot.cn/v1"),
      row("zhipuai", "sk-zhipu", "https://open.bigmodel.cn/api/paas/v4"),
    );

    expect(await probe("moonshotai")).toBe("upstream-ok");
    expect(await probe("zhipuai")).toBe("upstream-ok");

    expect(h.requests.map((r) => [r.url.replace(/\/chat\/completions$/, ""), r.auth])).toEqual([
      ["https://api.moonshot.cn/v1", "Bearer sk-moon"],
      ["https://open.bigmodel.cn/api/paas/v4", "Bearer sk-zhipu"],
    ]);
    expect((await resolveUpstream("user_a", "moonshotai")).source).toBe("provider_config");
  });

  it("行里 baseUrl 为空 → 用 provider 默认端点，绝不借用 env.UPSTREAM_BASE_URL（凭据与端点绑定）", async () => {
    h.rows.push(row("deepseek", "sk-user"));
    h.env.UPSTREAM_BASE_URL = "https://env-must-not-be-used.example";

    await probe("deepseek");

    // 用用户自己的 Key 却打到全局端点 = 把 A 的 Key 发给 B 的服务器，是串味
    expect(h.requests[0]!.url).toContain("api.deepseek.com");
    expect(h.requests[0]!.url).not.toContain("env-must-not-be-used");
    expect(h.requests[0]!.auth).toBe("Bearer sk-user");
  });

  it("无行 → 回退 env.UPSTREAM_API_KEY/BASE_URL（既有部署不用改任何东西）", async () => {
    h.env.UPSTREAM_API_KEY = "sk-env";
    h.env.UPSTREAM_BASE_URL = "https://env.example/v1";

    expect((await resolveUpstream("user_a", "openai")).source).toBe("env");
    await probe("openai");

    expect(h.requests[0]!.url).toContain("env.example/v1");
    expect(h.requests[0]!.auth).toBe("Bearer sk-env");
  });

  it("密文解不开（ENCRYPTION_KEY 换过）→ ProviderError，且**不**回退 env", async () => {
    h.rows.push({
      ...row("deepseek", null),
      apiKeyEncrypted: encryptSecret("sk-written-with-old-key", "a-different-encryption-key"),
    });
    h.env.UPSTREAM_API_KEY = "sk-env"; // 有 env 也不许兜：否则用户以为在用新 Key，实际在用旧的

    await expect(resolveUpstream("user_a", "deepseek")).rejects.toBeInstanceOf(ProviderError);
    expect(h.requests).toHaveLength(0);
  });

  it("别家配过 Key、唯独这家没有、env 也空 → ProviderError（不静默降级成 mock 假回复）", async () => {
    h.rows.push(row("openai", "sk-openai"));

    const err = await resolveUpstream("user_a", "deepseek").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ProviderError);
    expect((err as Error).message).toContain("deepseek");
    expect((err as Error).message).toContain("openai"); // 指明已配过哪家，用户知道该切成谁
    expect(h.requests).toHaveLength(0);
  });

  it("一把凭据都没有 → MockProvider，id 跟随请求的 provider（不记成 deepseek）", async () => {
    const resolved = await resolveUpstream("user_a", "moonshotai", {
      fetch: fakeFetch as unknown as typeof fetch,
    });

    expect(resolved.source).toBe("none");
    expect(resolved.provider).toBeInstanceOf(MockProvider);
    expect(resolved.provider.id).toBe("moonshotai");
    expect(await probe("moonshotai")).toContain("[mock]");
    expect(h.requests).toHaveLength(0); // 确认没有真的发请求
  });

  it("按用户隔离：别人的行不算「已配」", async () => {
    h.rows.push(row("openai", "sk-other-user", null, "user_b"));

    const resolved = await resolveUpstream("user_a", "openai");

    expect(resolved.source).toBe("none");
    expect(resolved.provider).toBeInstanceOf(MockProvider);
  });
});
