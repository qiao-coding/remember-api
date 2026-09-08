import { and, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { getDb, memories } from "@remember/db";
import { newId, type Memory, type MemoryType } from "@remember/shared";
import type {
  MemoryProvider,
  MemorySearchInput,
  MemorySearchItem,
  MemoryUpdateInput,
  MemoryWriteInput,
} from "./types.js";

/**
 * DbMemoryProvider —— 以本地 `memories` 表实现的记忆后端。
 *
 * 定位：MVP 期 Hermes 未接入时保证链路可运行；Hermes 就绪后工厂自动切换。
 * 检索采用关键词 ILIKE + 词命中率相关度（够用即可，后续可换向量检索）。
 */
export class DbMemoryProvider implements MemoryProvider {
  readonly name = "db";

  get enabled(): boolean {
    return true;
  }

  private toItem(row: typeof memories.$inferSelect): MemorySearchItem {
    return {
      id: row.id,
      userId: row.userId,
      projectId: row.projectId,
      type: row.type as MemoryType,
      content: row.content,
      importance: row.importance,
      pinned: row.pinned,
      source: row.source,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async get(id: string, userId: string): Promise<Memory | null> {
    const db = getDb();
    const row = (
      await db
        .select()
        .from(memories)
        .where(and(eq(memories.id, id), eq(memories.userId, userId)))
        .limit(1)
    )[0];
    return row ? this.toItem(row) : null;
  }

  async search(input: MemorySearchInput): Promise<MemorySearchItem[]> {
    const db = getDb();
    const { userId, projectId, query, limit = 5, pinnedOnly } = input;

    const conditions = [eq(memories.userId, userId)];
    if (projectId !== undefined) {
      conditions.push(
        projectId === null
          ? isNull(memories.projectId)
          : eq(memories.projectId, projectId),
      );
    }
    if (pinnedOnly) conditions.push(eq(memories.pinned, true));

    const terms = (query ?? "").split(/\s+/).filter(Boolean);
    if (terms.length) {
      conditions.push(
        or(...terms.map((t) => ilike(memories.content, `%${t}%`)))!,
      );
    }

    const rows = await db
      .select()
      .from(memories)
      .where(and(...conditions))
      .orderBy(desc(memories.updatedAt))
      .limit(100);

    // 相关度：命中词数 / 词数，× importance
    const scored: MemorySearchItem[] = rows.map((row) => {
      const hit = terms.filter((t) =>
        row.content.toLowerCase().includes(t.toLowerCase()),
      ).length;
      const relevance =
        terms.length === 0
          ? 0.5
          : Math.max(0.1, Math.round((hit / terms.length) * 100) / 100);
      return { ...this.toItem(row), relevance };
    });

    scored.sort(
      (a, b) =>
        (b.importance * (b.relevance ?? 0.5)) -
        (a.importance * (a.relevance ?? 0.5)),
    );
    return scored.slice(0, limit);
  }

  async write(input: MemoryWriteInput): Promise<Memory> {
    const db = getDb();
    const now = new Date();
    const id = input.id ?? newId("mem");
    const existing =
      input.id != null
        ? (
            await db
              .select()
              .from(memories)
              .where(and(eq(memories.id, id), eq(memories.userId, input.userId)))
              .limit(1)
          )[0]
        : undefined;

    if (existing) {
      await db
        .update(memories)
        .set({
          type: input.type,
          content: input.content,
          importance: input.importance ?? existing.importance,
          pinned: input.pinned ?? existing.pinned,
          source: input.source ?? existing.source,
          projectId: input.projectId !== undefined ? input.projectId : existing.projectId,
          updatedAt: now,
        })
        .where(eq(memories.id, existing.id));
    } else {
      await db.insert(memories).values({
        id,
        userId: input.userId,
        projectId: input.projectId ?? null,
        type: input.type,
        content: input.content,
        importance: input.importance ?? 0.5,
        pinned: input.pinned ?? false,
        source: input.source ?? null,
      });
    }

    const row = (
      await db
        .select()
        .from(memories)
        .where(eq(memories.id, id))
        .limit(1)
    )[0];
    if (!row) throw new Error("Memory 写入失败");
    return this.toItem(row);
  }

  async update(
    id: string,
    userId: string,
    input: MemoryUpdateInput,
  ): Promise<Memory> {
    const db = getDb();
    const existing = (
      await db
        .select()
        .from(memories)
        .where(and(eq(memories.id, id), eq(memories.userId, userId)))
        .limit(1)
    )[0];
    if (!existing) throw new Error(`Memory ${id} 不存在`);
    const row = (
      await db
        .update(memories)
        .set({
          ...(input.content !== undefined && { content: input.content }),
          ...(input.type !== undefined && { type: input.type }),
          ...(input.importance !== undefined && { importance: input.importance }),
          ...(input.pinned !== undefined && { pinned: input.pinned }),
          ...(input.projectId !== undefined && { projectId: input.projectId }),
          updatedAt: new Date(),
        })
        .where(eq(memories.id, id))
        .returning()
    )[0];
    if (!row) throw new Error(`Memory ${id} 更新失败`);
    return this.toItem(row);
  }

  async delete(id: string, userId: string): Promise<void> {
    const db = getDb();
    await db
      .delete(memories)
      .where(and(eq(memories.id, id), eq(memories.userId, userId)));
  }

  async list(input: {
    userId: string;
    projectId?: string | null;
    type?: MemoryType | null;
    pinnedOnly?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<MemorySearchItem[]> {
    const db = getDb();
    const conditions = [eq(memories.userId, input.userId)];
    if (input.projectId !== undefined) {
      conditions.push(
        input.projectId === null
          ? isNull(memories.projectId)
          : eq(memories.projectId, input.projectId),
      );
    }
    if (input.type) conditions.push(eq(memories.type, input.type));
    if (input.pinnedOnly) conditions.push(eq(memories.pinned, true));
    const rows = await db
      .select()
      .from(memories)
      .where(and(...conditions))
      .orderBy(desc(memories.updatedAt))
      .limit(input.limit ?? 50)
      .offset(input.offset ?? 0);
    return rows.map((r) => this.toItem(r));
  }
}
