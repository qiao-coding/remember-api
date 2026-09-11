import { describe, expect, it } from "vitest";
import { parseInitFlags, parseUpFlags, splitFlag } from "./flags.js";

describe("splitFlag", () => {
  it("拆出 --flag=value", () => {
    expect(splitFlag("--port=5433")).toEqual(["--port", "5433"]);
  });

  it("没有 = 就是空值（值在下一个参数里）", () => {
    expect(splitFlag("--port")).toEqual(["--port", ""]);
  });
});

describe("parseInitFlags", () => {
  it("一个参数都没给 → 空对象（照旧交互提问）", () => {
    expect(parseInitFlags([])).toEqual({});
  });

  it("收全无人值守需要的那些参数", () => {
    const opts = parseInitFlags([
      "--yes",
      "--url",
      "postgres://p@127.0.0.1:5432/db",
      "--provider",
      "deepseek",
      "--model",
      "deepseek-v4-flash",
      "--key",
      "sk-x",
    ]);
    expect(opts).toEqual({
      yes: true,
      url: "postgres://p@127.0.0.1:5432/db",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      key: "sk-x",
    });
  });

  it("支持 --flag=value 写法，且值里带 / 也不受影响", () => {
    const opts = parseInitFlags([
      "--provider=moonshotai",
      "--model=kimi-k2",
      "--base-url=https://api.moonshot.cn/v1",
    ]);
    expect(opts.provider).toBe("moonshotai");
    expect(opts.model).toBe("kimi-k2");
    expect(opts.baseUrl).toBe("https://api.moonshot.cn/v1");
  });

  it("-y 等价于 --yes", () => {
    expect(parseInitFlags(["-y"]).yes).toBe(true);
  });

  it("--port 合法才收；非数字/越界只 warn 不抛（别为参数写错打断向导）", () => {
    expect(parseInitFlags(["--port", "5433"]).port).toBe(5433);
    expect(parseInitFlags(["--port", "abc"]).port).toBeUndefined();
    expect(parseInitFlags(["--port", "70000"]).port).toBeUndefined();
  });

  it("--key 的值不会被当成下一个参数：--url 缺值时不吞掉 --provider", () => {
    // 回归：早先的实现无条件 i++，`--url --provider x` 会把 --provider 当值吞掉，
    // 于是 --provider 消失、无人值守缺参数时报错还指不到点子上。
    const opts = parseInitFlags(["--url", "--provider", "deepseek"]);
    expect(opts.url).toBeUndefined();
    expect(opts.provider).toBe("deepseek");
  });

  it("结尾的 --url（没有值）不会崩，也不会写成空串", () => {
    expect(parseInitFlags(["--url"]).url).toBeUndefined();
  });

  it("认不得的参数忽略掉，不影响后面的解析", () => {
    const opts = parseInitFlags(["--verbose", "--provider", "deepseek"]);
    expect(opts.provider).toBe("deepseek");
    expect(opts).not.toHaveProperty("verbose");
  });
});

describe("parseUpFlags", () => {
  it("空 → 空对象", () => {
    expect(parseUpFlags([])).toEqual({});
  });

  it("--port 两种写法都认，--host 也认", () => {
    expect(parseUpFlags(["--port", "4100"]).port).toBe(4100);
    expect(parseUpFlags(["--port=4100"]).port).toBe(4100);
    expect(parseUpFlags(["--host", "0.0.0.0"]).host).toBe("0.0.0.0");
  });

  it("非法端口忽略（起网关这件事不该被一个手滑的参数带偏）", () => {
    expect(parseUpFlags(["--port", "0"]).port).toBeUndefined();
    expect(parseUpFlags(["--port", "-1"]).port).toBeUndefined();
  });
});
