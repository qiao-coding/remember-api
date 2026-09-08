import type { MemoryType } from "@remember/shared";
import { estimateTokens } from "./token.js";

/**
 * Memory Budget —— 单次请求注入记忆的 Token 上限。
 *
 * 裁剪优先级（文档 §13）：Pinned > 项目决策 > 已知问题/状态 > 任务 > 偏好 > 历史，
 * 同级按 重要性 × 相关度 排序。
 */
export interface MemoryCandidate {
  id: string;
  content: string;
  type: MemoryType;
  importance: number; // 0~1
  pinned: boolean;
  /** 0~1，检索相关度 */
  relevance: number;
}

export interface BudgetResult {
  selected: MemoryCandidate[];
  dropped: MemoryCandidate[];
  totalTokens: number;
  budget: number;
}

const TYPE_PRIORITY: Record<MemoryType, number> = {
  decision: 1,
  issue: 2,
  status: 3,
  task: 4,
  preference: 5,
  history: 6,
};

export function priorityOf(m: MemoryCandidate): number {
  return m.pinned ? 0 : TYPE_PRIORITY[m.type];
}

export function candidateTokens(m: MemoryCandidate): number {
  return estimateTokens(m.content);
}

export function allocateMemoryBudget(
  candidates: MemoryCandidate[],
  budget: number,
): BudgetResult {
  const scored = candidates.map((c) => ({
    ...c,
    tokens: candidateTokens(c),
    score: c.importance * c.relevance,
  }));

  scored.sort(
    (a, b) => priorityOf(a) - priorityOf(b) || b.score - a.score,
  );

  const selected: MemoryCandidate[] = [];
  let totalTokens = 0;
  for (const c of scored) {
    if (totalTokens + c.tokens > budget) continue;
    selected.push(c);
    totalTokens += c.tokens;
  }

  const selectedIds = new Set(selected.map((s) => s.id));
  const dropped = scored.filter((s) => !selectedIds.has(s.id));

  return {
    selected,
    dropped,
    totalTokens,
    budget,
  };
}
