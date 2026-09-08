/**
 * crypto：Provider Key 对称加密 AES-256-GCM。
 * 关注：roundtrip、随机 iv（同明文两次密文不同）、GCM 认证（篡改/错 key 必须抛）。
 */
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./crypto";

const KEY = "test-encryption-key-for-unit";

describe("encryptSecret / decryptSecret", () => {
  it("roundtrip：解密(加密(plain)) === plain", () => {
    const plain = "sk-test-0123456789abcdef";
    const cipher = encryptSecret(plain, KEY);
    expect(decryptSecret(cipher, KEY)).toBe(plain);
  });

  it("同明文两次加密结果不同（随机 iv）", () => {
    const a = encryptSecret("same", KEY);
    const b = encryptSecret("same", KEY);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, KEY)).toBe("same");
    expect(decryptSecret(b, KEY)).toBe("same");
  });

  it("明文含中文/换行也能 roundtrip", () => {
    const plain = "密钥 中文\n第二行";
    const cipher = encryptSecret(plain, KEY);
    expect(decryptSecret(cipher, KEY)).toBe(plain);
  });

  it("篡改密文 → 抛错（GCM 认证失败）", () => {
    const cipher = encryptSecret("integrity", KEY);
    const buf = Buffer.from(cipher, "base64url");
    const last = buf.length - 1;
    buf[last] = (buf[last] ?? 0) ^ 0xff; // 翻转最后一个字节
    expect(() => decryptSecret(buf.toString("base64url"), KEY)).toThrow();
  });

  it("错误 key → 抛错", () => {
    const cipher = encryptSecret("secret", KEY);
    expect(() => decryptSecret(cipher, "wrong-key")).toThrow();
  });

  it("secret 为空 → 加密/解密都抛（ENCRYPTION_KEY 未配置）", () => {
    expect(() => encryptSecret("x", "")).toThrow(/ENCRYPTION_KEY/);
    expect(() => decryptSecret("x", "")).toThrow(/ENCRYPTION_KEY/);
  });

  it("非法 payload → 抛错", () => {
    expect(() => decryptSecret("not-base64url!!", KEY)).toThrow();
  });
});
