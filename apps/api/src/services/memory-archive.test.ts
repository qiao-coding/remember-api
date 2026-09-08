/**
 * 长对话归档纯逻辑单测 —— 不触 DB/网络/LLM，只验证水线判定、转写构建、JSON 解析等纯函数。
 * 编排函数 maybeArchiveLongConversation 依赖 DB+DeepSeek，交实机验证（阶段 D 后半）。
 */
import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@remember/shared";
import {
  buildTranscript,
  conversationIdOf,
  conversationScope,
  decideArchive,
  estimateConversationTokens,
  parseArchiveJson,
} from "./memory-archive.js";

const T = 1000; // 测试阈值

describe("conversationScope", () => {
  it("projectId → 原样；null → __global__", () => {
    expect(conversationScope("proj_1")).toBe("proj_1");
    expect(conversationScope(null)).toBe("__global__");
  });
});

describe("conversationIdOf：hash(首条 user 消息)", () => {
  const msgs = (first: string): ChatMessage[] => [
    { role: "system", content: "你是助手" },
    { role: "user", content: first },
    { role: "assistant", content: "好" },
  ];
  it("相同开场 → 相同 id（跨轮稳定）", () => {
    expect(conversationIdOf(msgs("帮我重构登录页"))).toBe(conversationIdOf(msgs("帮我重构登录页")));
  });
  it("不同开场 → 不同 id（换对话即变）", () => {
    expect(conversationIdOf(msgs("帮我重构登录页"))).not.toBe(
      conversationIdOf(msgs("帮我写一个组件")),
    );
  });
  it("跳过 system 取首条 user；无 user 消息 → 空串", () => {
    expect(conversationIdOf(msgs("x")).length).toBe(40); // sha1 hex = 40
    expect(conversationIdOf([{ role: "system", content: "仅系统" }])).toBe("");
  });
});

describe("estimateConversationTokens", () => {
  it("只数 user/assistant/tool，跳过 system（口径 = 对话增长）", () => {
    const msgs: ChatMessage[] = [
      { role: "system", content: "很长的一段系统提示词" },
      { role: "user", content: "你好" }, // CJK 2 → 2
      { role: "assistant", content: "Hello world" }, // 11 拉丁 → ceil(11/4)=3
      { role: "tool", content: "ok" }, // 2 → ceil(2/4)=1
    ];
    expect(estimateConversationTokens(msgs)).toBe(2 + 3 + 1);
  });
});

describe("decideArchive", () => {
  const base = {
    currentTokens: 0,
    thresholdTokens: T,
    growthRatio: 1,
    conversationId: "convA",
    watermark: null as null | { conversationId: string; lastArchivedTokens: number },
  };

  it("累计 < 阈值 → skip_short（短对话不碰 DB）", () => {
    expect(decideArchive({ ...base, currentTokens: T - 1 })).toBe("skip_short");
  });

  it("无水线且 ≥ 阈值（首归档）→ archive", () => {
    expect(decideArchive({ ...base, currentTokens: T })).toBe("archive");
  });

  it("同对话增长 ≥ ratio×阈值 → archive；不足 → skip_within_threshold", () => {
    const wm = { conversationId: "convA", lastArchivedTokens: T };
    expect(
      decideArchive({ ...base, watermark: wm, currentTokens: T + T }),
    ).toBe("archive");
    expect(
      decideArchive({ ...base, watermark: wm, currentTokens: T + 1 }),
    ).toBe("skip_within_threshold");
  });

  it("异对话（新对话复用/切换）≥ 阈值 → archive", () => {
    const wm = { conversationId: "convOld", lastArchivedTokens: 5 * T };
    expect(
      decideArchive({ ...base, watermark: wm, currentTokens: T }),
    ).toBe("archive");
  });

  it("同对话但累计萎缩（新对话复用同开场白）→ archive_reset 重置水线", () => {
    const wm = { conversationId: "convA", lastArchivedTokens: 5 * T };
    expect(
      decideArchive({ ...base, watermark: wm, currentTokens: T }),
    ).toBe("archive_reset");
  });
});

describe("parseArchiveJson", () => {
  it("容忍 ```json fence 与前后 prose", () => {
    const items = parseArchiveJson(
      '好，我提炼如下：\n```json\n[{"type":"decision","content":"项目代号定为 ALPHA-7","importance":0.8}]\n```\n——end',
    );
    expect(items).toEqual([
      { type: "decision", content: "项目代号定为 ALPHA-7", importance: 0.8 },
    ]);
  });

  it("空内容 → []", () => {
    expect(parseArchiveJson("")).toEqual([]);
    expect(parseArchiveJson("[]")).toEqual([]);
    expect(parseArchiveJson("没有值得保存的内容")).toEqual([]);
  });

  it("损坏 JSON → []（容错）", () => {
    expect(parseArchiveJson('{"type":"decision"')).toEqual([]);
  });

  it("部分合法项：非法 type/空 content 丢弃、importance 越界钳制、缺省 0.5", () => {
    const items = parseArchiveJson(
      JSON.stringify([
        { type: "decision", content: "好的决定", importance: 5 }, // imp 钳到 1
        { type: "oops", content: "非法 type" },
        { type: "preference", content: "" },
        { type: "issue", content: "失败了一次", importance: -3 }, // imp 钳到 0
        { type: "status", content: "完成" }, // imp 缺省 0.5
      ]),
    );
    expect(items).toEqual([
      { type: "decision", content: "好的决定", importance: 1 },
      { type: "issue", content: "失败了一次", importance: 0 },
      { type: "status", content: "完成", importance: 0.5 },
    ]);
  });
});

describe("buildTranscript", () => {
  it("丢 system/tool，追加本轮 assistant，超预算丢最旧", () => {
    const msgs: ChatMessage[] = [
      { role: "system", content: "注入的记忆与技能，勿归档" },
      { role: "user", content: "第一句" }, // CJK 3
      { role: "assistant", content: "第一答" }, // 3
      { role: "user", content: "第二句" }, // 3
      { role: "tool", content: "tool 结果勿归档" },
    ];
    const built = buildTranscript(msgs, "本轮回答", 10); // maxTokens 10
    const texts = built.map((m) => `${m.role}:${m.content}`);
    expect(texts).not.toContain("system:注入的记忆与技能，勿归档");
    expect(texts).not.toContain("tool:tool 结果勿归档");
    expect(texts[texts.length - 1]).toBe("assistant:本轮回答");
    // 超预算后总 token ≤ 10 且保留最新（最后一条是本轮回答）
    expect(estimateConversationTokens(built)).toBeLessThanOrEqual(10);
    expect(texts).not.toContain("user:第一句"); // 最旧的被丢
  });
});
