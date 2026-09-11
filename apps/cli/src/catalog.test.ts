import { describe, expect, it } from "vitest";
import {
  formatContext,
  formatCost,
  getProvider,
  listModels,
  listProviders,
} from "./catalog.js";

describe("目录读取", () => {
  it("能列出厂商，且每个都有模型（空模型表的厂商被过滤掉）", () => {
    const providers = listProviders();
    expect(providers.length).toBeGreaterThan(50);
    for (const p of providers) {
      expect(listModels(p.id).length).toBeGreaterThan(0);
    }
  });

  it("按名字排序（选择器里的顺序稳定）", () => {
    const names = listProviders().map((p) => p.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("deepseek：有目录端点、可直连、env 变量名可用于提示文案", () => {
    const p = getProvider("deepseek");
    expect(p).not.toBeNull();
    expect(p?.tier).toBe("compatible");
    expect(p?.api).toMatch(/^https:\/\//);
    expect(p?.envVar).toContain("DEEPSEEK");
  });

  it("openai：快照没给 api 字段，但有内置默认端点 → 仍算可直连", () => {
    // 这条覆盖「不是靠 provider.api 判可直连」的分支：内置端点表在
    // packages/providers/src/sdk.ts，这里通过问 resolveBaseUrl 一次来判定。
    const p = getProvider("openai");
    expect(p?.tier).toBe("compatible");
  });

  it("未知 id → null（不是抛错，选择器里要做存在性判断）", () => {
    expect(getProvider("no-such-provider-xyz")).toBeNull();
  });

  it("模型列表排除 deprecated", () => {
    const models = listModels("deepseek");
    expect(models.length).toBeGreaterThan(0);
    for (const m of models) {
      expect(m.status).not.toBe("deprecated");
    }
  });

  it("模型字段形状稳定：cost 要么 null 要么两个价格都是数字", () => {
    for (const p of listProviders().slice(0, 20)) {
      for (const m of listModels(p.id)) {
        expect(typeof m.id).toBe("string");
        expect(typeof m.name).toBe("string");
        expect(typeof m.toolCall).toBe("boolean");
        expect(m.contextLimit === null || typeof m.contextLimit === "number").toBe(true);
        if (m.cost) {
          expect(typeof m.cost.input).toBe("number");
          expect(typeof m.cost.output).toBe("number");
        }
      }
    }
  });

  it("未知厂商的模型列表是空数组，不是崩", () => {
    expect(listModels("no-such-provider-xyz")).toEqual([]);
  });
});

describe("展示格式化", () => {
  it("上下文长度", () => {
    expect(formatContext(128_000)).toBe("128K");
    expect(formatContext(1_000_000)).toBe("1M");
    expect(formatContext(1_048_576)).toBe("1M");
    expect(formatContext(200_000)).toBe("200K");
    expect(formatContext(null)).toBe("—");
    expect(formatContext(0)).toBe("—");
  });

  it("价格：缺价标订阅，极小值不显示成 $0.00", () => {
    expect(formatCost({ input: 0.27, output: 1.1 })).toBe("$0.27/$1.10");
    expect(formatCost({ input: 0, output: 0 })).toBe("$0/$0");
    expect(formatCost({ input: 0.001, output: 0.002 })).toBe("$0.001/$0.002");
    expect(formatCost(null)).toBe("订阅/未标价");
  });
});
