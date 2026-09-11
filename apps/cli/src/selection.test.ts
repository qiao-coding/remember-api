import { afterEach, describe, expect, it } from "vitest";
import type { CatalogProvider } from "./catalog.js";
import { chooseKey, resolveTarget } from "./selection.js";

describe("resolveTarget（非交互定目标）", () => {
  it("目录里有端点 → 直接用目录的", () => {
    const target = resolveTarget("deepseek", "deepseek-v4-flash");
    expect(target.provider).toBe("deepseek");
    expect(target.model).toBe("deepseek-v4-flash");
    expect(target.baseUrl).toBe("https://api.deepseek.com");
  });

  it("显式给的端点优先于目录（自建反代 / 网关都靠这条）", () => {
    const target = resolveTarget("deepseek", "deepseek-v4-flash", "https://my-proxy.local/v1");
    expect(target.baseUrl).toBe("https://my-proxy.local/v1");
  });

  it("目录里没有 api 的厂商（openai / anthropic）必须显式给端点，不许猜", () => {
    expect(() => resolveTarget("openai", "gpt-5")).toThrow(/--base-url/);
    expect(resolveTarget("openai", "gpt-5", "https://api.openai.com/v1").baseUrl).toBe(
      "https://api.openai.com/v1",
    );
  });

  it("目录里没有的 provider 也能用，前提是端点有着落", () => {
    expect(() => resolveTarget("my-own-gateway", "m")).toThrow(/--base-url/);
    expect(resolveTarget("my-own-gateway", "m", "https://gw.local/v1").provider).toBe(
      "my-own-gateway",
    );
  });

  it("目录里没有的模型名照用（快照总会比厂商发布慢一拍）", () => {
    const target = resolveTarget("deepseek", "deepseek-from-the-future");
    expect(target.model).toBe("deepseek-from-the-future");
  });
});

const provider: CatalogProvider = {
  id: "demo",
  name: "Demo",
  api: "https://api.demo.local/v1",
  envVar: "REMEMBER_API_TEST_KEY",
  tier: "compatible",
};

describe("chooseKey", () => {
  afterEach(() => {
    delete process.env.REMEMBER_API_TEST_KEY;
  });

  it("给了 --key 就直接用（值去掉首尾空格）", async () => {
    expect(await chooseKey(provider, false, { provided: "  sk-given  " })).toBe("sk-given");
  });

  it("无人值守 + 库里已有 Key → 保留（返回 null = 别覆盖）", async () => {
    expect(await chooseKey(provider, true, { unattended: true })).toBeNull();
  });

  it("无人值守 + 没存过 → 落到该厂商约定的环境变量", async () => {
    process.env.REMEMBER_API_TEST_KEY = "sk-from-env";
    expect(await chooseKey(provider, false, { unattended: true })).toBe("sk-from-env");
  });

  it("无人值守 + 什么都没有 → null，由调用方报「没有可用的 Key」", async () => {
    expect(await chooseKey(provider, false, { unattended: true })).toBeNull();
  });

  it("没有 envVar 的 provider 不会误取到别人的 Key", async () => {
    const noEnv: CatalogProvider = { ...provider, envVar: null };
    process.env.REMEMBER_API_TEST_KEY = "sk-from-env";
    expect(await chooseKey(noEnv, false, { unattended: true })).toBeNull();
  });
});
