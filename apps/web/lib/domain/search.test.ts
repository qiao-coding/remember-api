/** 顶栏全局搜索分组命中。 */
import { describe, expect, it } from "vitest";
import { SEARCH_LIMITS, filterSearchHits } from "./search";

const profiles = [
  { id: "p1", name: "Alpha Coach", model: "deepseek-chat" },
  { id: "p2", name: "Beta Writer", model: "deepseek-chat" },
];
const projects = [
  { id: "j1", name: "Gateway", description: "OpenAI 兼容网关", status: "active" },
  { id: "j2", name: "Website", description: null, status: null },
];

describe("filterSearchHits", () => {
  it("空 q → profiles/projects 全量，memories 也截断返回", () => {
    const hits = filterSearchHits({ q: "", profiles, projects, memories: ["a", "b", "c"] });
    expect(hits.query).toBe("");
    expect(hits.profileHits).toHaveLength(2);
    expect(hits.projectHits).toHaveLength(2);
    expect(hits.memoryHits).toEqual(["a", "b", "c"]);
  });

  it("name 大小写不敏感匹配 profiles", () => {
    const hits = filterSearchHits({ q: "aLPHA", profiles, projects, memories: [] });
    expect(hits.profileHits.map((p) => p.id)).toEqual(["p1"]);
  });

  it("projects 匹配 name 或 description（description 为 null 安全）", () => {
    const byDesc = filterSearchHits({ q: "兼容", profiles, projects, memories: [] });
    expect(byDesc.projectHits.map((p) => p.id)).toEqual(["j1"]);

    const byName = filterSearchHits({ q: "WEBSITE", profiles, projects, memories: [] });
    expect(byName.projectHits.map((p) => p.id)).toEqual(["j2"]);
  });

  it("保留元素扩展字段类型（id/model/status 可读）", () => {
    const hits = filterSearchHits({ q: "a", profiles, projects, memories: [] });
    expect(hits.profileHits[0]?.model).toBe("deepseek-chat");
    expect(hits.projectHits[0]?.status).toBe("active");
  });

  it("无匹配 → 空分组", () => {
    const hits = filterSearchHits({ q: "zzz", profiles, projects, memories: [] });
    expect(hits.profileHits).toEqual([]);
    expect(hits.projectHits).toEqual([]);
  });

  it("截断到各自上限", () => {
    const manyProfiles = Array.from({ length: 10 }, (_, i) => ({ id: String(i), name: `P${i}` }));
    const manyProjects = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      name: `J${i}`,
      description: null as string | null,
    }));
    const memories = Array.from({ length: 9 }, (_, i) => `m${i}`);
    const hits = filterSearchHits({
      q: "",
      profiles: manyProfiles,
      projects: manyProjects,
      memories,
    });
    expect(hits.profileHits).toHaveLength(SEARCH_LIMITS.profiles);
    expect(hits.projectHits).toHaveLength(SEARCH_LIMITS.projects);
    expect(hits.memoryHits).toHaveLength(SEARCH_LIMITS.memories);
  });

  it("首尾空格 trim 后再匹配", () => {
    const hits = filterSearchHits({ q: "  beta  ", profiles, projects, memories: [] });
    expect(hits.profileHits.map((p) => p.id)).toEqual(["p2"]);
  });
});
