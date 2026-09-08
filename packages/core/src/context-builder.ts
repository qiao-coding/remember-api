import type { ChatMessage, MemoryType } from "@remember/shared";
import { estimateTokens } from "./token.js";

/**
 * Context Builder —— 出站消息的两区拼装（薄桥的核心，~70 行）。
 *
 * 目标：对底层模型呈现一个**稳定前缀 + 逐字历史**，让 prompt cache 命中，实现"有状态的 LLM"。
 *   - system 区（固定）：客户端自带 system ⊕ Profile 人设 ⊕ 固定偏好 → 只在被编辑时变 → cache 前缀。
 *   - user 区（动态）：客户端历史逐字转发；本轮检索到的记忆**折叠进最后一条 user**（动态区），
 *     绝不塞进 system —— 否则前缀每轮都变，整段 cache 全 miss。
 *   - 不再注入 Project / Skills 内容（实体图不泄进 prompt，记忆是唯一事实源）。
 */

export interface ContextMemoryItem {
  type: MemoryType;
  content: string;
}

export interface BuildContextInput {
  /** 客户端自带 system 提示词内容（多条已合并的纯文本），拼进同一条 system */
  clientSystem?: string | null;
  /** Profile.systemPrompt */
  profileSystemPrompt?: string | null;
  /** 固定偏好（pinnedOnly 检索，预算内）→ system，稳定 */
  preferences?: ContextMemoryItem[];
  /** 本轮检索记忆（query 相关，预算内）→ 折叠进尾部最后一条 user */
  retrievedMemories?: ContextMemoryItem[];
  /** 客户端除 system 外的历史对话（user/assistant，逐字转发） */
  messages: ChatMessage[];
}

export interface ContextBreakdown {
  profileTokens: number;
  preferenceTokens: number;
  /** 恒 0：project 内容不再注入 */
  projectTokens: number;
  /** 尾部 [Relevant Memory] 块的 token */
  memoryTokens: number;
  /** 恒 0：skill 内容不再注入 */
  skillTokens: number;
  /** 客户端历史对话 token */
  messageTokens: number;
}

export interface BuildContextResult {
  /** 最终发给模型的 messages（首条为 system；记忆折叠进尾部 user） */
  messages: ChatMessage[];
  breakdown: ContextBreakdown;
}

function joinBlocks(...blocks: Array<string | null | undefined>): string {
  return blocks
    .map((b) => b?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n");
}

export function buildContext(input: BuildContextInput): BuildContextResult {
  const profileBody = input.profileSystemPrompt?.trim() ?? "";

  const prefs = input.preferences ?? [];
  const prefBody = prefs.length
    ? prefs.map((p) => `- ${p.content.trim()}`).join("\n")
    : "";

  // ── system 区（稳定前缀）──
  const systemContent = joinBlocks(
    input.clientSystem,
    profileBody ? `[Profile]\n${profileBody}` : "",
    prefBody ? `[User Preferences]\n${prefBody}` : "",
  );

  // ── 历史：逐字转发（丢 system，避免客户端 system 与我们的重复/漂移）──
  const dialog = input.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ ...m }));
  const messages: ChatMessage[] = systemContent
    ? [{ role: "system", content: systemContent }, ...dialog]
    : dialog;

  // ── 动态记忆：折叠进尾部最后一条 user（不新建 system、不改写历史，保前缀稳定）──
  const mems = input.retrievedMemories ?? [];
  let memoryText = "";
  if (mems.length) {
    memoryText =
      `[Relevant Memory]\n` +
      mems.map((m) => `- (${m.type}) ${m.content.trim()}`).join("\n");
    let lastUser = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]!.role === "user") {
        lastUser = i;
        break;
      }
    }
    if (lastUser >= 0) {
      const prev = messages[lastUser]!.content ?? "";
      messages[lastUser] = {
        role: "user",
        content: prev ? `${memoryText}\n\n${prev}` : memoryText,
      };
    } else {
      messages.push({ role: "user", content: memoryText });
    }
  }

  const messageTokens = dialog.reduce(
    (sum, m) => sum + estimateTokens(m.content ?? ""),
    0,
  );

  return {
    messages,
    breakdown: {
      profileTokens: estimateTokens(profileBody),
      preferenceTokens: estimateTokens(prefBody),
      projectTokens: 0,
      memoryTokens: estimateTokens(memoryText),
      skillTokens: 0,
      messageTokens,
    },
  };
}
