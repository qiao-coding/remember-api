import { DbMemoryProvider } from "./db.js";
import { Mem0MemoryProvider } from "./mem0.js";
import type { MemoryProvider } from "./types.js";

/**
 * MemoryProvider 工厂。
 * 优先级：MEM0_BASE_URL（Mem0 自托管）→ Hermes（占位，待接）→ DbMemoryProvider（本地表，保证链路可运行）。
 */
export function createMemoryProvider(config?: {
  baseUrl?: string;
  apiKey?: string;
}): MemoryProvider {
  if (config?.baseUrl) {
    return new Mem0MemoryProvider({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
    });
  }
  return new DbMemoryProvider();
}
