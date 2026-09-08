/** docs 页 API Key 选样/掩码（A3 回归点）。 */
import { describe, expect, it } from "vitest";
import { firstDisabledKey, firstEnabledKey, maskKey } from "./docs";

const key = (over: Partial<{ disabled: boolean; prefix: string; last4: string }> = {}) => ({
  id: "key_x",
  name: "k",
  disabled: false,
  prefix: "rma_abc",
  last4: "1234",
  ...over,
});

describe("firstEnabledKey / firstDisabledKey", () => {
  it("取第一个启用 key；无启用 → null", () => {
    const keys = [key({ disabled: true }), key({ disabled: false, last4: "2222" })];
    expect(firstEnabledKey(keys)?.last4).toBe("2222");
    expect(firstEnabledKey([key({ disabled: true })])).toBeNull();
    expect(firstEnabledKey([])).toBeNull();
  });

  it("取第一个禁用 key；无禁用 → null", () => {
    const keys = [key({ disabled: false, last4: "1111" }), key({ disabled: true, last4: "3333" })];
    expect(firstDisabledKey(keys)?.last4).toBe("3333");
    expect(firstDisabledKey([key()])).toBeNull();
    expect(firstDisabledKey([])).toBeNull();
  });
});

describe("maskKey", () => {
  it("只透出 prefix…last4，不含明文", () => {
    expect(maskKey({ prefix: "rma_ab", last4: "9f2c" })).toBe("rma_ab…9f2c");
  });
});
