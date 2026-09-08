/**
 * format.ts 全量格式化单测。
 * 日期格式依赖本地时区 → 用例用「同一 Date 实例」推导期望值，避免 CI 时区差异。
 * formatRelative 用 fake timers 固定 now。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatCost,
  formatDate,
  formatDateTime,
  formatInt,
  formatPercent,
  formatRelative,
} from "./format";

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
function dateTimeOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

describe("formatDateTime / formatDate", () => {
  it("合法 ISO → 本地 `YYYY-MM-DD HH:mm` / `YYYY-MM-DD`", () => {
    const d = new Date(2026, 0, 2, 3, 4, 5); // 本地 2026-01-02 03:04
    expect(formatDateTime(d.toISOString())).toBe(dateTimeOf(d));
    expect(formatDate(d.toISOString())).toBe(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    );
  });

  it("空 / 非法 → 占位符 —", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime("")).toBe("—");
    expect(formatDateTime("not-a-date")).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("garbage")).toBe("—");
  });
});

describe("formatRelative", () => {
  afterEach(() => vi.useRealTimers());

  it("按分钟/小时/天阶梯回退，超 7 天回绝对日期", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 5, 12, 0, 0));
    const now = Date.now();
    const ago = (ms: number) => new Date(now - ms).toISOString();

    expect(formatRelative(ago(30_000))).toBe("刚刚");
    expect(formatRelative(ago(5 * 60_000))).toBe("5 分钟前");
    expect(formatRelative(ago(3 * 3_600_000))).toBe("3 小时前");
    expect(formatRelative(ago(2 * 86_400_000))).toBe("2 天前");
    expect(formatRelative(ago(10 * 86_400_000))).toBe(
      formatDateTime(ago(10 * 86_400_000)),
    );
  });

  it("空 / 非法 → —", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 5, 12, 0, 0));
    expect(formatRelative("")).toBe("—");
    expect(formatRelative("nope")).toBe("—");
  });
});

describe("formatCost", () => {
  it("非有限值 → $0", () => {
    expect(formatCost(NaN)).toBe("$0");
    expect(formatCost(Infinity)).toBe("$0");
    expect(formatCost(null)).toBe("$0");
    expect(formatCost(undefined)).toBe("$0");
  });

  it("最多 6 位小数并去尾零；0 → $0", () => {
    expect(formatCost(0)).toBe("$0");
    expect(formatCost(1.5)).toBe("$1.5");
    expect(formatCost(12.34)).toBe("$12.34");
    expect(formatCost(0.0000012)).toBe("$0.000001");
    expect(formatCost(1.2345678)).toBe("$1.234568");
  });
});

describe("formatInt", () => {
  it("千分位分组；null → 0", () => {
    expect(formatInt(1234567)).toBe("1,234,567");
    expect(formatInt(0)).toBe("0");
    expect(formatInt(null)).toBe("0");
    expect(formatInt(undefined)).toBe("0");
  });
});

describe("formatPercent", () => {
  it("0–1 → 一位小数百分比", () => {
    expect(formatPercent(0.5)).toBe("50.0%");
    expect(formatPercent(1)).toBe("100.0%");
    expect(formatPercent(0)).toBe("0.0%");
    expect(formatPercent(null)).toBe("0.0%");
  });
});
