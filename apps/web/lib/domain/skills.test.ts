/** skills 页「被 Profile 引用」计数（A2 回归点）。 */
import { describe, expect, it } from "vitest";
import { countSkillUsage } from "./skills";

describe("countSkillUsage", () => {
  it("空 Profile 列表 → 空 Map", () => {
    expect(countSkillUsage([]).size).toBe(0);
  });

  it("统计每个 skillId 被多少 Profile 引用", () => {
    const profiles = [
      { skillIds: ["a", "b"] },
      { skillIds: ["a"] },
      { skillIds: ["c", "a", "b"] },
    ];
    const m = countSkillUsage(profiles);
    expect(m.get("a")).toBe(3);
    expect(m.get("b")).toBe(2);
    expect(m.get("c")).toBe(1);
  });

  it("未出现在任何 Profile 的 skill 不在结果里（页面以 ?? 0 兜底）", () => {
    const m = countSkillUsage([{ skillIds: ["a"] }]);
    expect(m.get("ghost")).toBeUndefined();
  });

  it("忽略 skillIds 为空的 Profile", () => {
    const m = countSkillUsage([{ skillIds: [] }, { skillIds: ["a"] }]);
    expect(m.get("a")).toBe(1);
  });
});
