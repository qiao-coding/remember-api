import { relations } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** users */
export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

/** api_keys —— 只存哈希与展示用片段，绝不存明文 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // 强制绑定个人 model(profile)：key 只能调用绑定它的那一个 model（子 agent），不再有"全量通用 key"。
    // 删除 profile 级联删绑定 key —— 防止 key 从"绑某 model"意外宽化成 user 级。
    profileId: text("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    last4: text("last4").notNull(),
    hash: text("hash").notNull(),
    disabled: boolean("disabled").notNull().default(false),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("api_keys_hash_idx").on(t.hash),
    index("api_keys_user_idx").on(t.userId),
    index("api_keys_profile_idx").on(t.profileId),
  ],
);

/** projects */
export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    summary: text("summary"),
    architecture: text("architecture"),
    status: text("status"),
    decisions: jsonb("decisions").$type<string[]>().notNull().default([]),
    knownIssues: jsonb("known_issues").$type<string[]>().notNull().default([]),
    memoryNamespace: text("memory_namespace").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("projects_user_name_idx").on(t.userId, t.name)],
);

/** profiles —— 客户端请求的 model 即 name */
export const profiles = pgTable(
  "profiles",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    // 强制绑定项目：一个个人 model(子 agent) 必属一个 project，删项目连带删其下 model。
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    systemPrompt: text("system_prompt"),
    memoryEnabled: boolean("memory_enabled").notNull().default(true),
    memoryBudget: integer("memory_budget").notNull().default(1500),
    skillIds: jsonb("skill_ids").$type<string[]>().notNull().default([]),
    temperature: doublePrecision("temperature"),
    maxTokens: integer("max_tokens"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("profiles_user_name_idx").on(t.userId, t.name)],
);

/** skills */
export const skills = pgTable(
  "skills",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    content: text("content").notNull(),
    tokenCount: integer("token_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("skills_user_name_idx").on(t.userId, t.name)],
);

/** provider_configs —— 用户在各 Provider 的密钥（加密存储） */
export const providerConfigs = pgTable(
  "provider_configs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    baseUrl: text("base_url"),
    defaultModel: text("default_model"),
    apiKeyEncrypted: text("api_key_encrypted"),
    isConnected: boolean("is_connected").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("provider_configs_user_provider_idx").on(t.userId, t.provider)],
);

/** memories —— 统一记忆元数据；Hermes 接入后作为本地镜像/缓存 */
export const memories = pgTable(
  "memories",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    content: text("content").notNull(),
    importance: doublePrecision("importance").notNull().default(0.5),
    pinned: boolean("pinned").notNull().default(false),
    source: text("source"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("memories_user_project_idx").on(t.userId, t.projectId),
    index("memories_type_idx").on(t.type),
  ],
);

/** request_usage —— 每次请求的用量/成本记录 */
export const requestUsage = pgTable(
  "request_usage",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cachedTokens: integer("cached_tokens").notNull().default(0),
    memoryTokens: integer("memory_tokens").notNull().default(0),
    skillTokens: integer("skill_tokens").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    estimatedCost: doublePrecision("estimated_cost").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("request_usage_user_created_idx").on(t.userId, t.createdAt),
    index("request_usage_profile_idx").on(t.profileId),
    index("request_usage_project_idx").on(t.projectId),
  ],
);

/**
 * conversation_watermarks —— 长对话归档的进度水线。
 * 每 (user_id, project_scope) 一行；conversation_id 变了（换新对话/萎缩重置）→ 水线重算。
 * 存 Postgres（非 mem0）理由：api 无状态、mem0 哨兵会污染检索且 add 不原地更新；
 * ON CONFLICT upsert 精确、并发友好，水线在提炼写成功后才推进。
 */
export const conversationWatermarks = pgTable(
  "conversation_watermarks",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** projectId ?? "__global__"（避免可空复合主键） */
    projectScope: text("project_scope").notNull(),
    /** sha1(hex) 第一条非 system 用户消息 → 跨累积轮次稳定、换对话才变 */
    conversationId: text("conversation_id").notNull(),
    /** 上次已归档到的 token 位置（该 watermark 推进后不重归档） */
    lastArchivedTokens: integer("last_archived_tokens").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.projectScope] })],
);

export const userRelations = relations(users, ({ many }) => ({
  apiKeys: many(apiKeys),
  projects: many(projects),
  profiles: many(profiles),
  skills: many(skills),
  memories: many(memories),
  usage: many(requestUsage),
}));

export const profileRelations = relations(profiles, ({ one }) => ({
  project: one(projects, {
    fields: [profiles.projectId],
    references: [projects.id],
  }),
}));
