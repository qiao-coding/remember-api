/**
 * recent 会话摘要单测 —— mock getDb / env / providers，验证：
 * decideRecentSummarize 纯判定、loadRecentThread 的 seal(active→prev)+注入与"同会话不 seal"、
 * maybeUpdateRecentThread 的短对话 skip、够长才首产 + transcript + LLM 输出 clamp + conversationId 落槽。
 * 不触真 DB/网络。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@remember/shared";
import { encryptSecret } from "@remember/shared";
import { conversationIdOf } from "./memory-archive.js";
import type { TurnMemoryInput } from "./memory-write.js";
import {
  decideRecentSummarize,
  loadRecentThread,
  maybeUpdateRecentThread,
  RECENT_SYSTEM_PROMPT,
} from "./recent-thread.js";

// ── mock：hoisted 共享实例（vi.mock 工厂需在测试顶部的 const 之外可引用）──
const h = vi.hoisted(() => {
  const db = {
    query: { conversationSummaries: { findFirst: vi.fn() } },
    insert: vi.fn(),
    inserted: [] as { vals: Record<string, unknown>; set?: Record<string, unknown> }[],
  };
  // insert().values(v).onConflictDoUpdate(opts) 链：都捕获（seal 走 set 分支）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).insert.mockImplementation(() => ({
    values: (vals: Record<string, unknown>) => ({
      onConflictDoUpdate: (opts: { set: Record<string, unknown> }) => {
        db.inserted.push({ vals, set: opts.set });
        return Promise.resolve();
      },
    }),
  }));
  return {
    db,
    chatSpy: vi.fn(async () => ({ content: "" })),
    /** findProviderConfig 的返回值（null = 该用户没配这家） */
    credRow: null as Record<string, unknown> | null,
    env: {
      UPSTREAM_API_KEY: "sk-x",
      UPSTREAM_BASE_URL: "",
      ENCRYPTION_KEY: "test-encryption-key",
      RECENT_MIN_TOKENS: 1000,
      RECENT_GROWTH_TOKENS: 800,
      RECENT_MAX_TRANSCRIPT_TOKENS: 3000,
      RECENT_MAX_INJECT_TOKENS: 300,
      ARCHIVE_PROVIDER: "deepseek",
      ARCHIVE_MODEL: "deepseek-chat",
    },
  };
});

vi.mock("@remember/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@remember/db")>();
  return {
    ...actual,
    getDb: () => h.db,
    // 同上：凭据助手内部用相对 import 拿 getDb，只在包边界替换才拦得住。
    // 默认 credRow=null → upstream 走 env 分支（本文件 env mock 里 UPSTREAM_API_KEY="sk-x"）。
    findProviderConfig: vi.fn(async () => h.credRow),
    listProviderConfigs: vi.fn(async () => []),
  };
});
// 展开 actual：ProviderError 是真类（错误分支靠 instanceof 判），只换掉 createProvider
vi.mock("@remember/providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@remember/providers")>()),
  createProvider: () => ({ chat: h.chatSpy }),
}));
vi.mock("../env.js", () => ({ env: h.env }));

interface Row {
  activeConversationId: string;
  activeSummaryText: string;
  lastSummarizedTokens: number;
}

function makeRow(over: Partial<Row>): Row {
  return {
    activeConversationId: "convA",
    activeSummaryText: "已有摘要",
    lastSummarizedTokens: 1000,
    ...over,
  };
}

function resetDb() {
  h.db.inserted.length = 0;
  h.db.query.conversationSummaries.findFirst.mockReset();
  h.db.query.conversationSummaries.findFirst.mockResolvedValue(undefined);
  h.chatSpy.mockReset();
  h.chatSpy.mockResolvedValue({ content: "" });
  h.credRow = null;
  h.env.UPSTREAM_API_KEY = "sk-x";
}

describe("decideRecentSummarize（纯判定）", () => {
  it("累计 < minTokens → skip（短对话不碰 DB/LLM）", () => {
    expect(decideRecentSummarize(null, "convA", 999, 1000, 800)).toBe("skip");
  });

  it("无行 / active 空 → initial（本会话首次够长）", () => {
    expect(decideRecentSummarize(null, "convA", 1000, 1000, 800)).toBe("initial");
    expect(
      decideRecentSummarize(makeRow({ activeConversationId: "" }), "convA", 1000, 1000, 800),
    ).toBe("initial");
  });

  it("active 归属别的会话 → skip（交接由 loadRecentThread seal 负责）", () => {
    const row = makeRow({ activeConversationId: "convOld", lastSummarizedTokens: 5000 });
    expect(decideRecentSummarize(row, "convNew", 1500, 1000, 800)).toBe("skip");
  });

  it("同会话已产过摘要：增长 < growth → skip；≥ growth → refresh", () => {
    const row = makeRow({});
    expect(decideRecentSummarize(row, "convA", 1000 + 799, 1000, 800)).toBe("skip");
    expect(decideRecentSummarize(row, "convA", 1000 + 800, 1000, 800)).toBe("refresh");
  });

  it("同会话 active 空文本 → 视为从未产过 → initial", () => {
    const row = makeRow({ activeSummaryText: "", lastSummarizedTokens: 0 });
    expect(decideRecentSummarize(row, "convA", 1200, 1000, 800)).toBe("initial");
  });
});

describe("loadRecentThread（seal + 注入）", () => {
  beforeEach(resetDb);

  it("新会话 + 上一会话已产摘要 → seal(active→prev) 并返回上一会话摘要", async () => {
    h.db.query.conversationSummaries.findFirst.mockResolvedValue({
      prevConversationId: "",
      prevSummaryText: "",
      prevSummaryTokens: 0,
      activeConversationId: "convOld",
      activeSummaryText: "上次在重构登录页，做到表单校验",
      lastSummarizedTokens: 1200,
    });
    const injected = await loadRecentThread({
      userId: "u1",
      profileId: "p1",
      currentConversationId: "convNew",
    });

    expect(injected).toBe("上次在重构登录页，做到表单校验");
    expect(h.db.inserted).toHaveLength(1);
    const rec = h.db.inserted[0]!;
    expect(rec.vals.prevConversationId).toBe("convOld");
    expect(rec.vals.prevSummaryText).toBe("上次在重构登录页，做到表单校验");
    expect(rec.vals.prevSummaryTokens).toBe(1200);
    // active 重置为跟踪新会话（走 onConflict set：行已存在时更新生效）
    expect(rec.set!.activeConversationId).toBe("convNew");
    expect(rec.set!.activeSummaryText).toBe("");
    expect(rec.set!.lastSummarizedTokens).toBe(0);
  });

  it("继续原会话（active 即当前）→ 不 seal，返回已冻结的 prev 交接块", async () => {
    h.db.query.conversationSummaries.findFirst.mockResolvedValue({
      prevConversationId: "convPrev",
      prevSummaryText: "上一段：定完技术栈",
      prevSummaryTokens: 900,
      activeConversationId: "convNew",
      activeSummaryText: "正在滚动的当前摘要",
      lastSummarizedTokens: 1500,
    });
    const injected = await loadRecentThread({
      userId: "u1",
      profileId: "p1",
      currentConversationId: "convNew",
    });
    expect(injected).toBe("上一段：定完技术栈");
    expect(h.db.inserted).toHaveLength(0); // 不 seal
  });

  it("超预算 → 截断到 maxInjectTokens（truncateToTokens 保守字符策略 300×2.5=750）", async () => {
    const long = "a".repeat(3000); // estimateTokens = 750 > 300
    h.db.query.conversationSummaries.findFirst.mockResolvedValue({
      prevConversationId: "",
      prevSummaryText: "",
      prevSummaryTokens: 0,
      activeConversationId: "convOld",
      activeSummaryText: long,
      lastSummarizedTokens: 3000,
    });
    const injected = await loadRecentThread({
      userId: "u1",
      profileId: "p1",
      currentConversationId: "convNew",
    });
    expect(injected.length).toBe(750);
    expect(h.db.inserted[0]!.vals.prevSummaryText).toHaveLength(750);
  });

  it("空会话 id → 空串，不碰 DB", async () => {
    await expect(
      loadRecentThread({ userId: "u1", profileId: "p1", currentConversationId: "" }),
    ).resolves.toBe("");
    expect(h.db.query.conversationSummaries.findFirst).not.toHaveBeenCalled();
  });
});

describe("maybeUpdateRecentThread（fire-and-forget 门 + 首产）", () => {
  beforeEach(resetDb);

  function input(over: Partial<TurnMemoryInput>): TurnMemoryInput {
    return {
      userId: "u1",
      projectId: "proj_1",
      profileId: "p1",
      providerName: "deepseek",
      userMessage: "x",
      assistantContent: "",
      messages: [{ role: "user", content: "x" }],
      memoryEnabled: true,
      ...over,
    };
  }

  it("memoryEnabled=false → 直接跳过", async () => {
    await maybeUpdateRecentThread(input({ memoryEnabled: false }));
    expect(h.db.query.conversationSummaries.findFirst).not.toHaveBeenCalled();
    expect(h.chatSpy).not.toHaveBeenCalled();
  });

  it("短对话（< minTokens）→ 不碰 DB 不调 LLM", async () => {
    await maybeUpdateRecentThread(input({})); // "x" ≈ 0 token
    expect(h.db.query.conversationSummaries.findFirst).not.toHaveBeenCalled();
    expect(h.chatSpy).not.toHaveBeenCalled();
  });

  it("会话累计 ≥ min 且无行 → 首产：RECENT_SYSTEM_PROMPT+转写喂 LLM，落 active 槽并记位置", async () => {
    const long = "x".repeat(5000); // ≈1250 token
    const messages: ChatMessage[] = [{ role: "user", content: long }];
    const convId = conversationIdOf(messages);
    h.chatSpy.mockResolvedValue({ content: "x".repeat(2000) }); // 超预算 → clamp 750

    await maybeUpdateRecentThread(
      input({ messages, userMessage: long, assistantContent: "" }),
    );

    expect(h.chatSpy).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callMsgs = (h.chatSpy.mock.calls[0] as any)[0].messages as {
      role: string;
      content: string;
    }[];
    expect(callMsgs[0]!.content).toBe(RECENT_SYSTEM_PROMPT);
    // 布局 = system(提示) + 转写(user+空assistant) + 收尾 user
    expect(callMsgs.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(callMsgs[callMsgs.length - 1]!.role).toBe("user");

    expect(h.db.inserted).toHaveLength(1);
    const rec = h.db.inserted[0]!;
    expect(rec.vals.activeConversationId).toBe(convId);
    expect(rec.vals.activeSummaryText).toHaveLength(750); // clamp 到 maxInjectTokens
    expect(rec.vals.lastSummarizedTokens).toBe(1250);
    // active 刷新只 set active 槽，绝不动 prev（prev 只由 loadRecentThread seal 写）
    expect(rec.set!.prevSummaryText).toBeUndefined();
    expect(rec.set!.activeConversationId).toBe(convId);
  });

  // 凭据从 env 搬到 provider_configs 后最容易踩的坑：前置门槛还按 `!env.UPSTREAM_API_KEY`
  // 早退，于是本地模式下（env 空、Key 只在库里）摘要被**静默跳过** —— 没有任何报错。
  it("env 无 key、Key 只在 provider_configs 里 → 照常产摘要（不被静默跳过）", async () => {
    h.env.UPSTREAM_API_KEY = "";
    h.credRow = {
      provider: "deepseek",
      baseUrl: null,
      apiKeyEncrypted: encryptSecret("sk-in-db", h.env.ENCRYPTION_KEY),
    };
    h.chatSpy.mockResolvedValue({ content: "摘要" });
    const long = "x".repeat(5000); // ≈1250 token

    await maybeUpdateRecentThread(
      input({ messages: [{ role: "user", content: long }], userMessage: long }),
    );

    expect(h.chatSpy).toHaveBeenCalledTimes(1);
    expect(h.db.inserted).toHaveLength(1);
  });

  it("DB 读失败 → 吞错（fire-and-forget 不 throw）", async () => {
    h.db.query.conversationSummaries.findFirst.mockRejectedValue(new Error("db down"));
    const messages: ChatMessage[] = [{ role: "user", content: "x".repeat(5000) }];
    await expect(maybeUpdateRecentThread(input({ messages }))).resolves.toBeUndefined();
  });
});
