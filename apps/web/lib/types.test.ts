/**
 * types.ts 的展示层常量与后端枚举对齐锁定。
 * MEMORY_TYPE_LABEL 若漏掉 shared 里新增的 MemoryType，UI 会把裸 type 当文案透出（倒挂）。
 * 这里的键集合与后端 MEMORY_TYPES 全等，谁少补谁。
 */
import { describe, expect, it } from "vitest";
import { MEMORY_TYPES } from "@remember/shared";
import { MEMORY_TYPE_LABEL } from "./types";

describe("MEMORY_TYPE_LABEL", () => {
  it("键集合与 @remember/shared 的 MEMORY_TYPES 完全一致（不多不少）", () => {
    expect(Object.keys(MEMORY_TYPE_LABEL).sort()).toEqual(
      [...MEMORY_TYPES].sort(),
    );
  });

  it("每个类型都有非空中文文案", () => {
    for (const t of MEMORY_TYPES) {
      expect(MEMORY_TYPE_LABEL[t]).toBeTruthy();
    }
  });
});
