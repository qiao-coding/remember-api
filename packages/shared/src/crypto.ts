import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Provider Key 的对称加密 —— AES-256-GCM。
 * 密钥由 ENCRYPTION_KEY 派生，密文包含 iv + authTag。
 *
 * 放在 shared 而不是 api 里：网关（写/读 provider_configs）与 CLI（录入 Key）必须是同一套
 * 实现，否则 CLI 写的密文网关解不开。
 */
function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(plain: string, secret: string): string {
  if (!secret) throw new Error("ENCRYPTION_KEY 未配置");
  const key = deriveKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

export function decryptSecret(payload: string, secret: string): string {
  if (!secret) throw new Error("ENCRYPTION_KEY 未配置");
  const buf = Buffer.from(payload, "base64url");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const key = deriveKey(secret);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
