/** memories 页的纯判定/序列化：展开/收起、focus 兜底、列表查询串。便于单测。 */

import type { MemoryType } from "@remember/shared";

export type MemoryBadgeVariant =
  | "default"
  | "secondary"
  | "success"
  | "warning"
  | "destructive"
  | "outline";

/** MemoryType → Badge variant（与 shadcn Badge 变体对齐）。 */
export const TYPE_VARIANT: Record<MemoryType, MemoryBadgeVariant> = {
  preference: "success",
  decision: "default",
  status: "secondary",
  task: "warning",
  issue: "destructive",
  history: "outline",
};

/**
 * 行内内容展开 toggle：同一 id 再点 → 收起(null)；其它 id → 单开。
 * 维护「同一时间只展开一条」不变式。
 */
export function memoryToggle(expandedId: string | null, id: string): string | null {
  return expandedId === id ? null : id;
}

/** 内容超过阈值才显示「展开/收起」按钮（默认与页面内联阈值一致：80 字）。 */
export function memoryNeedsExpand(content: string, threshold = 80): boolean {
  return content.length > threshold;
}

export interface FocusTargetCheck {
  /** 全局搜索跳转目标 ?focus=<id> */
  focus: string | null;
  /** 当前列表结果行的 id */
  rowIds: readonly string[];
  /** 列表已从 loading 沉降（!isLoading || 已有 data） */
  listSettled: boolean;
  /** 列表加载出错（出错时不再额外拉单条） */
  listError: boolean;
}

/**
 * focus 目标不在当前筛选结果里时，是否拉单条置顶展示。
 * 目标已在 rows 中 → 纯滚动高亮，不需要兜底请求。
 */
export function focusMemoryFallbackNeeded({
  focus,
  rowIds,
  listSettled,
  listError,
}: FocusTargetCheck): boolean {
  if (focus == null) return false;
  return listSettled && !listError && !rowIds.includes(focus);
}

/** /api/memories 列表查询参数。 */
export interface MemoryQuery {
  q?: string;
  projectId?: string;
  type?: MemoryType | "";
  pinnedOnly?: boolean;
  limit?: number;
}

/** MemoryQuery → query string（字段有值才带；limit 恒带，缺省 50）。 */
export function memoryQueryString(f: MemoryQuery): string {
  const params = new URLSearchParams();
  if (f.q) params.set("q", f.q);
  if (f.projectId) params.set("projectId", f.projectId);
  if (f.type) params.set("type", f.type);
  if (f.pinnedOnly) params.set("pinnedOnly", "true");
  params.set("limit", String(f.limit ?? 50));
  return params.toString();
}
