/** 顶栏全局搜索分组命中 —— 纯函数，便于单测。 */

export const SEARCH_LIMITS = {
  profiles: 6,
  projects: 6,
  memories: 5,
} as const;

/** 泛型保留调用方元素类型（page 仍能读 p.id / p.model 等扩展字段）。 */
export interface SearchFilterInput<
  P extends { name: string },
  J extends { name: string; description?: string | null },
  M,
> {
  q: string;
  profiles: readonly P[];
  projects: readonly J[];
  /** memories 命中由后端按 q 搜索返回（limit 已定），前端只截断展示条数。 */
  memories: readonly M[];
}

/**
 * 大小写不敏感 includes 过滤，各分组截断到上限。
 * q 为空 → profiles/projects 全量（前 N 条），memories 分组整体不展示（由调用方用 query 判空）。
 */
export function filterSearchHits<
  P extends { name: string },
  J extends { name: string; description?: string | null },
  M,
>(input: SearchFilterInput<P, J, M>): {
  query: string;
  profileHits: P[];
  projectHits: J[];
  memoryHits: M[];
} {
  const query = input.q.trim().toLowerCase();
  const profileHits = input.profiles
    .filter((p) => !query || p.name.toLowerCase().includes(query))
    .slice(0, SEARCH_LIMITS.profiles);
  const projectHits = input.projects
    .filter(
      (p) =>
        !query ||
        p.name.toLowerCase().includes(query) ||
        (p.description ?? "").toLowerCase().includes(query),
    )
    .slice(0, SEARCH_LIMITS.projects);
  const memoryHits = input.memories.slice(0, SEARCH_LIMITS.memories);
  return { query, profileHits, projectHits, memoryHits };
}
