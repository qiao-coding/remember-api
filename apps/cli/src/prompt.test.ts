/**
 * `@clack/prompts` 的薄封装。
 *
 * 这里判错的后果是**静默的**：Ctrl-C / Esc 在 clack 里返回一个 symbol 而不是抛错，
 * 不 unwrap 就会带着它一路往下走，最后在某个 DB 写入或 JSON.stringify 处才炸，
 * 且报错完全看不懂。所以逐条钉住「什么算取消、什么不算」。
 *
 * ⚠️ `isCancel` 的真值只认 clack 自己导出的 `CANCEL_SYMBOL`（`Symbol(clack:cancel)`），
 * 它**不是**「是不是 symbol」的判定。本机实测：`isCancel(Symbol('cancel')) === false`。
 * 随手造一个 symbol 去测「取消」这条路，会写出一条永远走不到的假绿断言——所以下面
 * 特意用 CANCEL_SYMBOL 测真分支、用一个自造 symbol 测**不该**走的那条。
 */
import { afterEach, describe, expect, it } from "vitest";
import { CANCEL_SYMBOL } from "@clack/prompts";
import { CancelledError, isInteractive, required, shorten, unwrap, validateUrl } from "./prompt.js";

describe("unwrap —— 只把 clack 的真取消当取消", () => {
  it("CANCEL_SYMBOL 抛 CancelledError", () => {
    expect(() => unwrap(CANCEL_SYMBOL)).toThrow(CancelledError);
    expect(() => unwrap(CANCEL_SYMBOL)).toThrow("已取消");
  });

  it("自造的 symbol 不算取消（isCancel 的真语义，别写反）", () => {
    expect(() => unwrap(Symbol("cancel"))).not.toThrow();
  });

  it("普通值原样返回（含假值，别把 0 / false 当取消）", () => {
    expect(unwrap("deepseek")).toBe("deepseek");
    expect(unwrap(0)).toBe(0);
    expect(unwrap(false)).toBe(false);
    expect(unwrap("")).toBe("");
  });

  it("undefined 不抛 —— 所以拦空值靠的是 required()，不是 unwrap()", () => {
    expect(unwrap(undefined)).toBeUndefined();
  });
});

describe("required", () => {
  const need = required("名称");

  it("非空通过（含首尾空白）", () => {
    expect(need("deepseek")).toBeUndefined();
    expect(need("  deepseek  ")).toBeUndefined();
  });

  it.each([undefined, "", "   ", "\n"])("空值报错：%j", (value) => {
    expect(need(value)).toBe("名称不能为空");
  });
});

describe("validateUrl", () => {
  it.each(["https://api.deepseek.com", "http://127.0.0.1:4000", "https://api.deepseek.com/v1/"])(
    "接受 %s",
    (value) => {
      expect(validateUrl(value)).toBeUndefined();
    },
  );

  it.each([undefined, "", "   "])("空值：%j", (value) => {
    expect(validateUrl(value)).toBe("端点不能为空");
  });

  it.each(["ftp://x.com", "file:///c:/x", "ws://x.com"])("非 http(s)：%s", (value) => {
    expect(validateUrl(value)).toBe("端点必须是 http(s) 开头");
  });

  it("裸主机名不合法 —— 用户最常这么填，必须被拦下", () => {
    expect(validateUrl("api.deepseek.com")).toMatch(/不是合法的 URL/);
  });

  it.each(["不是个 URL", "http://", "://x"])("垃圾输入：%s", (value) => {
    expect(validateUrl(value)).toMatch(/不是合法的 URL/);
  });
});

describe("shorten", () => {
  it("短值原样返回", () => {
    expect(shorten("abc")).toBe("abc");
  });

  it("阈值是 keep*2+1：正好等于时不截断，多一位才截", () => {
    expect(shorten("a".repeat(13))).toBe("a".repeat(13));
    expect(shorten("a".repeat(14))).toBe("aaaaaa…aaaaaa");
  });

  it("截断后保留首尾各 keep 位", () => {
    const key = "rma_1234567890abcdef";

    expect(shorten(key)).toBe("rma_12…abcdef");
    expect(shorten(key, 4)).toBe("rma_…cdef");
  });
});

describe("isInteractive —— 决定「能不能弹交互向导」", () => {
  // 原始描述符可能不存在（非 TTY 时 process.stdin.isTTY 往往压根没有这个属性）
  const original = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");

  function setTty(value: unknown): void {
    Object.defineProperty(process.stdin, "isTTY", { value, configurable: true, writable: true });
  }

  afterEach(() => {
    if (original) Object.defineProperty(process.stdin, "isTTY", original);
    else delete (process.stdin as { isTTY?: unknown }).isTTY;
  });

  it("isTTY 为 true 才算交互", () => {
    setTty(true);
    expect(isInteractive()).toBe(true);
  });

  it.each([false, undefined, null, 0, ""])("isTTY = %j → false", (value) => {
    setTty(value);
    expect(isInteractive()).toBe(false);
  });
});
