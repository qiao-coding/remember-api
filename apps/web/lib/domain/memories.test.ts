/**
 * memories 页纯判定：Badge 变体全量、展开/收起单开不变式、focus 兜底拉单条、列表查询串。
 */
import { describe, expect, it } from "vitest";
import { MEMORY_TYPES } from "@remember/shared";
import {
  TYPE_VARIANT,
  focusMemoryFallbackNeeded,
  memoryNeedsExpand,
  memoryQueryString,
  memoryToggle,
} from "./memories";

describe("TYPE_VARIANT", () => {
  it("键集合覆盖 shared 全部 MemoryType（不漏 badge variant）", () => {
    expect(Object.keys(TYPE_VARIANT).sort()).toEqual([...MEMORY_TYPES].sort());
  });

  it("取值都是合法 Badge variant", () => {
    const valid = new Set(["default", "secondary", "success", "warning", "destructive", "outline"]);
    for (const v of Object.values(TYPE_VARIANT)) expect(valid.has(v)).toBe(true);
  });
});

describe("memoryToggle", () => {
  it("未展开 → 展开该行", () => {
    expect(memoryToggle(null, "m1")).toBe("m1");
    expect(memoryToggle("m2", "m1")).toBe("m1");
  });

  it("再点同一行 → 收起 (null)", () => {
    expect(memoryToggle("m1", "m1")).toBeNull();
  });
});

describe("memoryNeedsExpand", () => {
  it("> 80 字才显示展开按钮；边界 80 不展开", () => {
    expect(memoryNeedsExpand("x".repeat(81))).toBe(true);
    expect(memoryNeedsExpand("x".repeat(80))).toBe(false);
    expect(memoryNeedsExpand("短")).toBe(false);
  });

  it("支持自定义阈值", () => {
    expect(memoryNeedsExpand("12345", 4)).toBe(true);
  });
});

describe("focusMemoryFallbackNeeded", () => {
  const base = { focus: "m9", rowIds: ["m1", "m2"], listSettled: true, listError: false };

  it("目标已在列表 → 不需要拉单条（纯滚动高亮）", () => {
    expect(focusMemoryFallbackNeeded({ ...base, rowIds: ["m1", "m9"] })).toBe(false);
  });

  it("无 focus → false", () => {
    expect(focusMemoryFallbackNeeded({ ...base, focus: null })).toBe(false);
  });

  it("列表未沉降（首载 loading）→ false", () => {
    expect(focusMemoryFallbackNeeded({ ...base, listSettled: false })).toBe(false);
  });

  it("列表报错 → 不再额外拉单条", () => {
    expect(focusMemoryFallbackNeeded({ ...base, listError: true })).toBe(false);
  });

  it("目标被筛选排除且列表已就绪无错 → true", () => {
    expect(focusMemoryFallbackNeeded(base)).toBe(true);
  });
});

describe("memoryQueryString", () => {
  it("空过滤 → 只有 limit=50", () => {
    expect(memoryQueryString({})).toBe("limit=50");
  });

  it("有值字段带出，空/未选忽略", () => {
    expect(
      memoryQueryString({ q: "bug", projectId: "prj_1", type: "issue", pinnedOnly: true }),
    ).toBe("q=bug&projectId=prj_1&type=issue&pinnedOnly=true&limit=50");
  });

  it("空串/空 type 不占位", () => {
    const qs = memoryQueryString({ q: "", projectId: undefined, type: "" });
    expect(qs).toBe("limit=50");
  });

  it("pinnedOnly=false 省略；limit 可覆盖", () => {
    expect(memoryQueryString({ pinnedOnly: false, limit: 100 })).toBe("limit=100");
  });

  it("含空格的关键字按 URLSearchParams 编码", () => {
    expect(memoryQueryString({ q: "a b" })).toBe("q=a+b&limit=50");
  });
});
