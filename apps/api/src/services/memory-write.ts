import type { MemoryType } from "@remember/shared";
import { createMemoryProvider } from "@remember/memory";
import { env } from "../env.js";

/**
 * 回合结束后的记忆写入（异步、低优先级）。
 * 用规则启发式识别值得保存的内容，写入前先检索去重，避免 Memory 爆炸。
 */
const PREFERENCE_RE = /(以后|记住|偏好|prefer|always use|from now on|请使用|请用)/i;
const DECISION_RE = /(决定|采用|选择|不使用|不再使用|decided|decision|改用)/i;
const STATUS_RE = /(已完成|已经完成|完成.*了|done|finished|implemented)/i;
const FAILED_RE = /(失败|不行|无法使用|尝试.*(失败|不行)|doesn't work|failed)/i;

export async function writeTurnMemories(params: {
  userId: string;
  projectId: string | null;
  userMessage: string;
  assistantContent: string;
  providerName: string;
}): Promise<void> {
  const provider = createMemoryProvider(
    env.MEM0_BASE_URL
      ? { baseUrl: env.MEM0_BASE_URL, apiKey: env.MEM0_API_KEY }
      : undefined,
  );
  if (!provider.enabled) return;

  const { userMessage, assistantContent } = params;
  const candidates: { type: MemoryType; content: string }[] = [];

  // 用户明确表达的长期偏好（带"以后/记住"等强信号）
  if (userMessage.length > 10 && PREFERENCE_RE.test(userMessage)) {
    candidates.push({ type: "preference", content: userMessage.slice(0, 500) });
  }
  // 架构/技术决策（带"决定/采用"等信号）
  if (DECISION_RE.test(assistantContent)) {
    candidates.push({ type: "decision", content: assistantContent.slice(0, 500) });
  }
  // 失败尝试
  if (FAILED_RE.test(assistantContent)) {
    candidates.push({ type: "issue", content: assistantContent.slice(0, 500) });
  }
  // 状态更新
  if (STATUS_RE.test(assistantContent)) {
    candidates.push({ type: "status", content: assistantContent.slice(0, 500) });
  }

  // 去重 + 写入（每轮最多 2 条）
  for (const cand of candidates.slice(0, 2)) {
    try {
      const similar = await provider.search({
        userId: params.userId,
        projectId: params.projectId,
        query: cand.content.slice(0, 60),
        limit: 1,
      });
      if (similar[0] && (similar[0].relevance ?? 0) >= 0.9) continue; // 已存在
      await provider.write({
        userId: params.userId,
        projectId: params.projectId,
        type: cand.type,
        content: cand.content,
        source: params.providerName,
      });
    } catch (err) {
      console.error("[memory-write] 写入失败:", err);
    }
  }
}
