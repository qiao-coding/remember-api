import type { Memory, MemoryType } from "@remember/shared";
import { newId } from "@remember/shared";
import type {
  MemoryProvider,
  MemorySearchItem,
  MemoryUpdateInput,
  MemoryWriteInput,
} from "./types.js";

/**
 * NoopMemoryProvider —— 未配置 Hermes 时的兜底实现。
 * search 返回空、write 直接丢弃（避免阻塞链路），方便未接记忆后端时先行开发验证。
 */
export class NoopMemoryProvider implements MemoryProvider {
  readonly name = "noop";

  get enabled(): boolean {
    return false;
  }

  async search(): Promise<MemorySearchItem[]> {
    return [];
  }

  async get(): Promise<Memory | null> {
    return null;
  }

  async write(input: MemoryWriteInput): Promise<Memory> {
    return {
      id: newId("mem"),
      userId: input.userId,
      projectId: input.projectId ?? null,
      type: input.type,
      content: input.content,
      importance: input.importance ?? 0.5,
      pinned: input.pinned ?? false,
      source: input.source ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async update(id: string, userId: string, input: MemoryUpdateInput): Promise<Memory> {
    void id;
    void userId;
    void input;
    throw new Error("NoopMemoryProvider 不支持 update");
  }

  async delete(): Promise<void> {
    // no-op
  }

  async list(): Promise<MemorySearchItem[]> {
    return [];
  }
}

export type { MemoryType };
