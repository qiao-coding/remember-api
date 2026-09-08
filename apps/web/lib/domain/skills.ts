/** skills 页「被多少 Profile 引用」计数 —— 纯函数，便于单测。 */

/**
 * 遍历所有 Profile 的 skillIds，返回 `skillId → 引用次数`。
 * 未在任何 Profile 里引用的 skill 不会出现在结果中（调用方以 `?? 0` 兜底）。
 */
export function countSkillUsage(
  profiles: readonly { skillIds: readonly string[] }[],
): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of profiles) {
    for (const sid of p.skillIds) {
      m.set(sid, (m.get(sid) ?? 0) + 1);
    }
  }
  return m;
}
