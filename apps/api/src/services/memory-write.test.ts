/**
 * 写侧薄桥单测 —— mock @remember/memory 为 spy provider（仿 memories.inject.test.ts）。
 * 验证：memoryEnabled=false → 不写；耐久陈述 → 逐字写一次 preference(importance 0.8)；
 * 疑问/请求/确认/过短/过长 → 不写。不再有规则引擎/归一化判重（去重交给 mem0 服务端）。不触 DB/网络。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  looksLikeFact,
  writeTurnMemories,
  type TurnMemoryInput,
} from "./memory-write.js";

const fakeProvider = {
  name: "fake",
  enabled: true,
  write: vi.fn(async () => ({ id: "m_written" })),
};

vi.mock("@remember/memory", () => ({ createMemoryProvider: () => fakeProvider }));

function makeInput(overrides: Partial<TurnMemoryInput> = {}): TurnMemoryInput {
  return {
    userId: "usr_1",
    projectId: "proj_1",
    profileId: "profile_1",
    providerName: "deepseek",
    userMessage: "我的项目代号是 ALPHA-7",
    assistantContent: "",
    messages: [],
    memoryEnabled: true,
    ...overrides,
  };
}

describe("looksLikeFact（结构护栏，无内容信号词）", () => {
  it("耐久陈述句 → true", () => {
    expect(looksLikeFact("我的项目代号是 ALPHA-7")).toBe(true);
    expect(looksLikeFact("以后数据库统一用 PostgreSQL，不用 MySQL")).toBe(true);
    expect(looksLikeFact("不要用 Redux，改用 zustand")).toBe(true);
    expect(looksLikeFact("已完成了登录页开发")).toBe(true);
  });

  it("疑问句 → false", () => {
    expect(looksLikeFact("应该用哪个数据库比较好？")).toBe(false);
    expect(looksLikeFact("今天天气不错，你觉得呢")).toBe(false);
    expect(looksLikeFact("这样可以吗")).toBe(false);
  });

  it("请求/寒暄/确认 → false", () => {
    expect(looksLikeFact("帮我用 React 写个按钮")).toBe(false);
    expect(looksLikeFact("你能解释一下这个报错吗")).toBe(false);
    expect(looksLikeFact("好的，明白了")).toBe(false);
    expect(looksLikeFact("谢谢")).toBe(false);
  });

  it("长度护栏：过短(<4)/过长(>160)/纯标点 → false", () => {
    expect(looksLikeFact("对")).toBe(false);
    expect(looksLikeFact("好的！")).toBe(false);
    expect(looksLikeFact("？!...")).toBe(false);
    expect(looksLikeFact("这是一句非常长".repeat(25))).toBe(false);
  });
});

describe("writeTurnMemories", () => {
  beforeEach(() => {
    fakeProvider.write.mockClear();
  });

  it("memoryEnabled=false → 不写（修复旧 bug：禁用仍写）", async () => {
    await writeTurnMemories(makeInput({ memoryEnabled: false }));
    expect(fakeProvider.write).not.toHaveBeenCalled();
  });

  it("后端未配置(enabled=false) → 不写", async () => {
    const orig = fakeProvider.enabled;
    fakeProvider.enabled = false;
    try {
      await writeTurnMemories(makeInput());
    } finally {
      fakeProvider.enabled = orig;
    }
    expect(fakeProvider.write).not.toHaveBeenCalled();
  });

  it("耐久陈述「我的项目代号是 ALPHA-7」→ 逐字写一次 preference + importance", async () => {
    await writeTurnMemories(makeInput());
    expect(fakeProvider.write).toHaveBeenCalledTimes(1);
    expect(fakeProvider.write).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "usr_1",
        projectId: "proj_1",
        type: "preference",
        content: "我的项目代号是 ALPHA-7",
        importance: 0.8,
        source: "deepseek",
      }),
    );
  });

  it("寒暄/提问 → 不写", async () => {
    await writeTurnMemories(
      makeInput({ userMessage: "今天天气不错，你觉得呢", assistantContent: "哈哈" }),
    );
    await writeTurnMemories(makeInput({ userMessage: "帮我总结一下这段代码" }));
    expect(fakeProvider.write).not.toHaveBeenCalled();
  });

  it("超长陈述仍逐字入库但整句（无截断无改写）", async () => {
    const msg = "统一用 PostgreSQL 作为主库，Redis 只做缓存，不用 MySQL。";
    await writeTurnMemories(makeInput({ userMessage: msg }));
    expect(fakeProvider.write).toHaveBeenCalledTimes(1);
    expect(fakeProvider.write).toHaveBeenCalledWith(
      expect.objectContaining({ content: msg }),
    );
  });
});
