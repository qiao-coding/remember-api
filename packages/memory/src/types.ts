import type { Memory, MemoryType } from "@remember/shared";

/**
 * MemoryProvider 契约 —— remember-api 只依赖该接口，不依赖具体记忆后端。
 * 可替换实现：Hermes / ReMe / Mem0 / 本地存储。
 */

export interface MemorySearchInput {
  userId: string;
  /** 限定项目命名空间；undefined = 不限，null = 仅用户级全局记忆 */
  projectId?: string | null;
  /** 检索查询（自然语言/关键词） */
  query?: string;
  /** Top-K 上限 */
  limit?: number;
  /** 是否只取 pinned */
  pinnedOnly?: boolean;
}

export interface MemoryWriteInput {
  userId: string;
  projectId?: string | null;
  type: MemoryType;
  content: string;
  importance?: number;
  pinned?: boolean;
  source?: string;
  /** 提供 id 表示更新（merge）而非新建 */
  id?: string;
}

export interface MemoryUpdateInput {
  content?: string;
  type?: MemoryType;
  importance?: number;
  pinned?: boolean;
  projectId?: string | null;
}

export interface MemorySearchItem extends Memory {
  /** 0~1 相关度（由后端计算） */
  relevance?: number;
}

export interface MemoryProvider {
  readonly name: string;
  search(input: MemorySearchInput): Promise<MemorySearchItem[]>;
  get(id: string, userId: string): Promise<Memory | null>;
  write(input: MemoryWriteInput): Promise<Memory>;
  update(id: string, userId: string, input: MemoryUpdateInput): Promise<Memory>;
  delete(id: string, userId: string): Promise<void>;
  list(input: {
    userId: string;
    projectId?: string | null;
    type?: MemoryType | null;
    pinnedOnly?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<MemorySearchItem[]>;
  /** 是否真正可写（未配置后端时为 false，写操作降级为跳过） */
  get enabled(): boolean;
}
