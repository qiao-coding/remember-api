/**
 * 两区拼装布局单测 —— 锁住"稳定前缀 + 动态记忆折叠尾部"这一定架构，防止 cache 特性回归。
 * 不触 DB/网络：只验证 buildContext 的输出 message 数组布局。
 *   system = client ⊕ [Profile] ⊕ [User Preferences]（无 [Relevant Memory]）
 *   历史逐字转发（丢客户端 system）；[Relevant Memory] 折叠进最后一条 user。
 */
import { describe, expect, it } from "vitest";
import { buildContext } from "@remember/core";
import type { ChatMessage } from "@remember/shared";

const hist = (): ChatMessage[] => [
  { role: "system", content: "客户端自己的 system" },
  { role: "user", content: "第一句历史" },
  { role: "assistant", content: "第一答" },
  { role: "user", content: "本轮问题" },
];

describe("buildContext 两区布局", () => {
  it("system = 客户端 ⊕ Profile ⊕ 固定偏好；绝不含 [Relevant Memory]", () => {
    const { messages } = buildContext({
      clientSystem: "客户端自己的 system",
      profileSystemPrompt: "你是个人助手",
      preferences: [{ type: "preference", content: "用 PostgreSQL" }],
      retrievedMemories: [{ type: "decision", content: "代号定为 ALPHA-7" }],
      messages: hist(),
    });
    expect(messages[0]!.role).toBe("system");
    const sys = messages[0]!.content!;
    expect(sys).toContain("客户端自己的 system");
    expect(sys).toContain("[Profile]");
    expect(sys).toContain("你是个人助手");
    expect(sys).toContain("[User Preferences]");
    expect(sys).toContain("用 PostgreSQL");
    expect(sys).not.toContain("[Relevant Memory]"); // 动态记忆绝不进稳定前缀
    expect(sys).not.toContain("ALPHA-7");
  });

  it("历史逐字转发（丢客户端 system）；记忆折叠进最后一条 user", () => {
    const { messages } = buildContext({
      clientSystem: "客户端自己的 system",
      profileSystemPrompt: "你是个人助手",
      retrievedMemories: [{ type: "decision", content: "代号定为 ALPHA-7" }],
      messages: hist(),
    });
    const users = messages.filter((m) => m.role === "user");
    // 只该有 2 条 user：一条历史（逐字）+ 折叠了记忆的本轮
    expect(users.map((m) => m.content)).toContain("第一句历史");
    const last = users[users.length - 1]!.content!;
    expect(last).toContain("[Relevant Memory]");
    expect(last).toContain("ALPHA-7");
    expect(last).toContain("本轮问题"); // 记忆只作前缀折叠，不改写用户原文
    // 转发时丢弃客户端 system（并入首条 system，不单独出现）
    expect(messages.filter((m) => m.role === "system")).toHaveLength(1);
  });

  it("无动态记忆时：system 无记忆、最后一条 user 原样", () => {
    const { messages, breakdown } = buildContext({
      clientSystem: "客户端自己的 system",
      messages: hist(),
    });
    expect(messages[0]!.content).toBe("客户端自己的 system");
    expect(messages[messages.length - 1]!.content).toBe("本轮问题");
    expect(breakdown.memoryTokens).toBe(0);
    expect(breakdown.skillTokens).toBe(0);
    expect(breakdown.projectTokens).toBe(0);
  });

  it("有记忆但历史无 user → 追加一条 user 承载记忆（不新建 system）", () => {
    const { messages } = buildContext({
      retrievedMemories: [{ type: "status", content: "登录页已完成" }],
      messages: [{ role: "assistant", content: "收到" }],
    });
    const last = messages[messages.length - 1]!;
    expect(last.role).toBe("user");
    expect(last.content).toContain("登录页已完成");
    // 首条若是 system 则无内容应省略：这里无 persona/client → 无 system
    expect(messages[0]!.role).toBe("assistant");
  });
});
