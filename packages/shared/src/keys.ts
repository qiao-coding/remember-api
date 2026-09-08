import { randomBytes, scryptSync } from "node:crypto";
import { API_KEY_PREFIX } from "./constants.js";

/** 生成 `rma_` 开头的 API Key 明文（仅生成时展示一次） */
export function generateApiKey(): string {
  const raw = randomBytes(30).toString("base64url");
  return `${API_KEY_PREFIX}${raw}`;
}

/**
 * 校验并规整用户自定义 secret（如 `sk-123456`）。
 * 通过则返回 trim 后的原串（不改写用户选择）；否则抛错。
 * 最小长度 8；拒绝换行/仅空白。服务端只对返回串跑 hashApiKey 落库。
 */
export function assertCustomSecret(raw: string): string {
  const s = raw.replace(/\s+/g, "").trim();
  if (s.length < 8) {
    throw new RangeError("自定义 secret 至少 8 个字符（不含空白）");
  }
  return s;
}

/** 哈希 API Key —— 数据库只存哈希。pepper 作为 salt 防止彩虹表 */
export function hashApiKey(plain: string, pepper: string): string {
  return scryptSync(plain, pepper, 32).toString("hex");
}

/** 明文 Key → 展示用片段（前缀 + 末4位） */
export function maskApiKey(plain: string): { prefix: string; last4: string } {
  return {
    prefix: plain.slice(0, 8),
    last4: plain.slice(-4),
  };
}
