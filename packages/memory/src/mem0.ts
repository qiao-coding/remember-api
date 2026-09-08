import type { Memory, MemoryType } from "@remember/shared";
import type {
  MemoryProvider,
  MemorySearchInput,
  MemorySearchItem,
  MemoryUpdateInput,
  MemoryWriteInput,
} from "./types.js";

/**
 * Mem0MemoryProvider —— 对接 Mem0 自托管 OSS 记忆后端（Hermes 官方支持的 memory provider 之一）。
 *
 * 接口规格来源：mem0ai/mem0 server/main.py + schemas.py（OSS 路径无 /v1 前缀）：
 *  - POST   /memories            {messages, user_id, agent_id, metadata, infer}
 *  - POST   /search              {query, filters:{user_id,agent_id}, top_k}
 *  - GET    /memories            ?user_id=&agent_id=&top_k=        → {results:[...]}
 *  - GET    /memories/{id}       → 单条记忆
 *  - PUT    /memories/{id}       {text, metadata}
 *  - DELETE /memories/{id}       → {message}
 *
 * 约定：
 *  - remember-api 的项目隔离 → Mem0 的 agent_id；记忆的类型/重要度/固定/来源 → metadata（rm_* 前缀）。
 *  - 写入用 infer:false，逐字存储，不做 LLM 抽取，保证决策/偏好类记忆内容不被改写。
 *  - 认证：配置 apiKey 时走 X-API-Key（本地开发可设 AUTH_DISABLED=true 免认证）。
 */

/** Mem0 服务端返回的单条记忆（_serialize_memory 形状） */
interface Mem0Row {
  id?: string | null;
  memory?: string | null;
  data?: string | null;
  user_id?: string | null;
  agent_id?: string | null;
  run_id?: string | null;
  hash?: string | null;
  expiration_date?: string | null;
  metadata?: Record<string, unknown> | null;
  /** 仅在 /search 返回 */
  score?: number;
  created_at?: string;
  updated_at?: string;
}

const META_TYPE = "rm_type";
const META_IMPORTANCE = "rm_importance";
const META_PINNED = "rm_pinned";
const META_SOURCE = "rm_source";

export class Mem0MemoryProvider implements MemoryProvider {
  readonly name = "mem0";

  constructor(
    private readonly config: {
      baseUrl: string;
      apiKey?: string;
    },
  ) {}

  get enabled(): boolean {
    return true;
  }

  private get base(): string {
    return this.config.baseUrl.replace(/\/$/, "");
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(this.config.apiKey ? { "X-API-Key": this.config.apiKey } : {}),
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      throw new Error(`Mem0 请求失败 ${path}: ${res.status} ${await res.text().catch(() => "")}`);
    }
    return (await res.json()) as T;
  }

  /** 兼容 {results:[...]} / 裸数组 / 裸对象 三种返回包 */
  private unwrap<T>(json: unknown): T[] {
    if (Array.isArray(json)) return json as T[];
    if (json && typeof json === "object") {
      const maybe = (json as Record<string, unknown>).results;
      if (Array.isArray(maybe)) return maybe as T[];
      return [(json as T)];
    }
    return [];
  }

  private toMemory(row: Mem0Row): Memory {
    const meta = row.metadata ?? {};
    const rawType = meta[META_TYPE];
    const type: MemoryType = rawType === "preference" || rawType === "decision" || rawType === "status" || rawType === "task" || rawType === "issue" || rawType === "history"
      ? rawType
      : "history";
    return {
      id: row.id ?? "",
      userId: row.user_id ?? "mem0",
      projectId: row.agent_id ?? null,
      type,
      content: row.memory ?? row.data ?? "",
      importance: typeof meta[META_IMPORTANCE] === "number" ? (meta[META_IMPORTANCE] as number) : 0.5,
      pinned: meta[META_PINNED] === true,
      source: typeof meta[META_SOURCE] === "string" ? (meta[META_SOURCE] as string) : null,
      createdAt: row.created_at ?? new Date().toISOString(),
      updatedAt: row.updated_at ?? new Date().toISOString(),
    };
  }

  private entityFilters(userId: string, projectId?: string | null): Record<string, string> {
    const filters: Record<string, string> = { user_id: userId };
    if (projectId) filters.agent_id = projectId;
    return filters;
  }

  private writeMeta(input: Pick<MemoryWriteInput, "type" | "importance" | "pinned" | "source">) {
    const meta: Record<string, unknown> = {
      [META_TYPE]: input.type,
      [META_IMPORTANCE]: input.importance ?? 0.5,
      [META_PINNED]: input.pinned ?? false,
    };
    if (input.source) meta[META_SOURCE] = input.source;
    return meta;
  }

  async search(input: MemorySearchInput): Promise<MemorySearchItem[]> {
    const res = await this.request<unknown>("/search", {
      method: "POST",
      body: JSON.stringify({
        query: input.query ?? "",
        filters: this.entityFilters(input.userId, input.projectId),
        top_k: input.limit ?? 5,
      }),
    });
    let rows = this.unwrap<Mem0Row>(res);
    if (input.projectId === null) {
      rows = rows.filter((r) => !r.agent_id);
    }
    return rows.map((r) => ({
      ...this.toMemory(r),
      relevance: typeof r.score === "number" ? r.score : undefined,
    }));
  }

  async get(id: string, userId: string): Promise<Memory | null> {
    try {
      // mem0 OSS 没有 GET /memories/{id}（返回 405），改从该用户自己的列表按 id 找。
      // 列表按 user_id 服务端过滤，天然防越权；mem.userId 比对仅作纵深防御。
      const qs = new URLSearchParams({ user_id: userId, top_k: "1000" });
      const res = await this.request<unknown>(`/memories?${qs.toString()}`);
      const row = this.unwrap<Mem0Row>(res).find((r) => r.id === id);
      if (!row) return null;
      const mem = this.toMemory(row);
      if (mem.userId !== userId) return null;
      return mem;
    } catch {
      return null;
    }
  }

  async write(input: MemoryWriteInput): Promise<Memory> {
    const res = await this.request<unknown>("/memories", {
      method: "POST",
      body: JSON.stringify({
        messages: [{ role: "user", content: input.content }],
        user_id: input.userId,
        ...(input.projectId ? { agent_id: input.projectId } : {}),
        metadata: this.writeMeta(input),
        // 逐字存储，不经过 LLM 抽取
        infer: false,
      }),
    });
    const row = this.unwrap<Mem0Row>(res)[0];
    if (!row || !row.id) throw new Error("Mem0 写入失败：未返回记忆 id");
    return this.toMemory({
      ...row,
      user_id: row.user_id ?? input.userId,
      agent_id: row.agent_id ?? input.projectId ?? null,
    });
  }

  async update(id: string, userId: string, input: MemoryUpdateInput): Promise<Memory> {
    const existing = await this.get(id, userId);
    if (!existing) throw new Error(`Memory ${id} 不存在`);

    if (input.projectId !== undefined && input.projectId !== existing.projectId) {
      const moved = await this.write({
        userId,
        projectId: input.projectId,
        type: input.type ?? existing.type,
        content: input.content ?? existing.content,
        importance: input.importance ?? existing.importance,
        pinned: input.pinned ?? existing.pinned,
        source: existing.source ?? undefined,
      });
      await this.delete(id, userId).catch(() => undefined);
      return moved;
    }

    const body: Record<string, unknown> = {};
    if (input.content !== undefined) body.text = input.content;
    const meta: Record<string, unknown> = {};
    if (input.type !== undefined) meta[META_TYPE] = input.type;
    if (input.importance !== undefined) meta[META_IMPORTANCE] = input.importance;
    if (input.pinned !== undefined) meta[META_PINNED] = input.pinned;
    if (Object.keys(meta).length) body.metadata = meta;
    if (Object.keys(body).length) {
      await this.request<unknown>(`/memories/${id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
    }

    return {
      ...existing,
      content: input.content ?? existing.content,
      type: input.type ?? existing.type,
      importance: input.importance ?? existing.importance,
      pinned: input.pinned ?? existing.pinned,
      projectId: input.projectId ?? existing.projectId,
      updatedAt: new Date().toISOString(),
    };
  }

  async delete(id: string, userId: string): Promise<void> {
    // 先校验归属，防越权删除他人记忆（IDOR）
    const existing = await this.get(id, userId);
    if (!existing) throw new Error(`Memory ${id} 不存在`);
    await this.request<unknown>(`/memories/${id}`, { method: "DELETE" });
  }

  async list(input: {
    userId: string;
    projectId?: string | null;
    type?: MemoryType | null;
    pinnedOnly?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<MemorySearchItem[]> {
    const qs = new URLSearchParams({
      user_id: input.userId,
      top_k: String(input.limit ?? 50),
    });
    if (input.projectId) qs.set("agent_id", input.projectId);
    const res = await this.request<unknown>(`/memories?${qs.toString()}`);
    let items = this.unwrap<Mem0Row>(res).map((r) => this.toMemory(r));
    if (input.projectId === null) items = items.filter((m) => m.projectId === null);
    if (input.type) items = items.filter((m) => m.type === input.type);
    if (input.pinnedOnly) items = items.filter((m) => m.pinned);
    return items.slice(input.offset ?? 0, (input.offset ?? 0) + (input.limit ?? 50));
  }
}
