/**
 * manager 路由 zod schema 校验测试。
 * 覆盖：必填、越界、provider enum 锁、memoryBudget clamp、key 掩码语义所需输入。
 * schema 从路由文件导出（每新增字段/收紧约束都先改这里）。
 */
import { describe, expect, it, vi } from "vitest";
import { PROVIDER_IDS } from "@remember/shared";

// 路由模块 import 时只需表/DB 名字存在；handler 不会在此执行。
vi.mock("@remember/db", () => ({
  getDb: vi.fn(),
  apiKeys: {},
  profiles: {},
  projects: {},
  providerConfigs: {},
}));
vi.mock("@remember/memory", () => ({ createMemoryProvider: vi.fn() }));

import { CreateKeySchema, KeyPatchSchema } from "./keys.js";
import { ProfileSchema } from "./profiles.js";
import { ProviderSchema } from "./providers.js";
import { MemoryCreateSchema, MemoryPatchSchema } from "./memories.js";

const validProfile = {
  name: "助手",
  provider: "deepseek",
  model: "deepseek-chat",
  projectId: "proj_a",
  memoryEnabled: true,
  memoryBudget: 1500,
};

describe("ProfileSchema", () => {
  it("合法 body 通过（memoryEnabled 缺省为 true）", () => {
    const out = ProfileSchema.parse({ ...validProfile, memoryEnabled: undefined });
    expect(out.memoryEnabled).toBe(true);
  });

  it("name/model 必填且非空", () => {
    expect(() => ProfileSchema.parse({ ...validProfile, name: "" })).toThrow();
    expect(() => ProfileSchema.parse({ ...validProfile, model: "" })).toThrow();
    expect(() => ProfileSchema.parse({ ...validProfile, name: undefined })).toThrow();
  });

  it("projectId 必填非空（强制隔离：每个 model 必须绑定项目）", () => {
    expect(() => ProfileSchema.parse({ ...validProfile, projectId: undefined })).toThrow();
    expect(() => ProfileSchema.parse({ ...validProfile, projectId: null })).toThrow();
    expect(() => ProfileSchema.parse({ ...validProfile, projectId: "" })).toThrow();
    expect(ProfileSchema.parse(validProfile).projectId).toBe("proj_a");
  });

  it("provider 仅接受 shared 的 PROVIDER_IDS（不再锁 deepseek）", () => {
    expect(ProfileSchema.parse({ ...validProfile, provider: "deepseek" }).provider).toBe("deepseek");
    expect(ProfileSchema.parse({ ...validProfile, provider: "anthropic" }).provider).toBe("anthropic");
    expect(() => ProfileSchema.parse({ ...validProfile, provider: "claude" })).toThrow();
  });

  it("memoryBudget 夹在 [100, 100_000] 且为整数", () => {
    expect(() => ProfileSchema.parse({ ...validProfile, memoryBudget: 50 })).toThrow();
    expect(() => ProfileSchema.parse({ ...validProfile, memoryBudget: 100_001 })).toThrow();
    expect(() => ProfileSchema.parse({ ...validProfile, memoryBudget: 100.5 })).toThrow();
    expect(ProfileSchema.parse({ ...validProfile, memoryBudget: 100 }).memoryBudget).toBe(100);
  });
});

describe("ProviderSchema", () => {
  it("provider 仅接受 shared 的 PROVIDER_IDS", () => {
    for (const p of PROVIDER_IDS) {
      expect(ProviderSchema.parse({ provider: p }).provider).toBe(p);
    }
    expect(() => ProviderSchema.parse({ provider: "claude" })).toThrow();
  });

  it("apiKey 提供则非空；缺省可无", () => {
    expect(ProviderSchema.parse({ provider: "deepseek" }).apiKey).toBeUndefined();
    expect(() => ProviderSchema.parse({ provider: "deepseek", apiKey: "" })).toThrow();
  });
});

describe("CreateKeySchema / KeyPatchSchema", () => {
  it("name 必填非空", () => {
    expect(CreateKeySchema.parse({ name: "本地", profileId: "prof_x" }).name).toBe("本地");
    expect(() => CreateKeySchema.parse({ name: "", profileId: "prof_x" })).toThrow();
  });

  it("KeyPatchSchema 需要布尔 disabled 或 profileId", () => {
    expect(KeyPatchSchema.parse({ disabled: true }).disabled).toBe(true);
    expect(() => KeyPatchSchema.parse({ disabled: "yes" })).toThrow();
    expect(() => KeyPatchSchema.parse({})).toThrow();
  });

  it("CreateKeySchema：profileId 必填（强制绑定个人 model）且 secret 至少 8 字符", () => {
    expect(CreateKeySchema.parse({ name: "A", profileId: "prof_x", secret: "sk-12345678" }).profileId).toBe("prof_x");
    expect(() => CreateKeySchema.parse({ name: "A", profileId: null })).toThrow();
    expect(() => CreateKeySchema.parse({ name: "A" })).toThrow();
    expect(() => CreateKeySchema.parse({ name: "A", profileId: "" })).toThrow();
    expect(() => CreateKeySchema.parse({ name: "A", profileId: "prof_x", secret: "short" })).toThrow();
    expect(() => CreateKeySchema.parse({ name: "A", profileId: "prof_x", secret: "" })).toThrow();
  });

  it("KeyPatchSchema：profileId 可换绑；null 拒绝；空串拒绝", () => {
    expect(KeyPatchSchema.parse({ profileId: "prof_b" }).profileId).toBe("prof_b");
    expect(() => KeyPatchSchema.parse({ profileId: null })).toThrow();
    expect(() => KeyPatchSchema.parse({ profileId: "" })).toThrow();
  });
});

describe("Memory schemas", () => {
  it("MemoryCreateSchema：content/type 必填，type 限枚举", () => {
    expect(MemoryCreateSchema.parse({ content: "记一下", type: "decision" }).type).toBe("decision");
    expect(() => MemoryCreateSchema.parse({ content: "", type: "decision" })).toThrow();
    expect(() => MemoryCreateSchema.parse({ content: "x", type: "weird" })).toThrow();
    expect(() => MemoryCreateSchema.parse({ content: "x" })).toThrow();
  });

  it("importance 夹在 [0,1]", () => {
    expect(() => MemoryCreateSchema.parse({ content: "x", type: "status", importance: 1.5 })).toThrow();
    expect(() => MemoryCreateSchema.parse({ content: "x", type: "status", importance: -0.1 })).toThrow();
    expect(MemoryCreateSchema.parse({ content: "x", type: "status", importance: 0.5 }).importance).toBe(0.5);
  });

  it("MemoryPatchSchema：字段全可选；content 提供则非空", () => {
    expect(MemoryPatchSchema.parse({ pinned: true }).pinned).toBe(true);
    expect(() => MemoryPatchSchema.parse({ content: "" })).toThrow();
    expect(() => MemoryPatchSchema.parse({ type: "oops" })).toThrow();
    expect(MemoryPatchSchema.parse({}).projectId).toBeUndefined();
  });
});
