/**
 * 共享领域类型 —— remember-api 的 API 层与 Web 层共用的实体定义。
 */

/** 记忆类型：决策/状态/任务/问题/偏好/历史 */
export type MemoryType =
  | "preference"
  | "decision"
  | "status"
  | "task"
  | "issue"
  | "history";

export const MEMORY_TYPES: readonly MemoryType[] = [
  "preference",
  "decision",
  "status",
  "task",
  "issue",
  "history",
];

/** 记忆层级（对应文档 L0~L3），用于标记记忆的来源层级 */
export type MemoryTier = "preference" | "project-summary" | "retrieved" | "raw";

/**
 * 底层模型 Provider 标识。
 *
 * 刻意**不是**封闭联合：真实的厂商登记表是 `@opencode-ai/models` 的 models.dev 快照
 * （213 家，其中 173 家能走现有 OpenAI 兼容桥），而 `profiles.provider` 与
 * `provider_configs.provider` 在库里本来就是自由 `text`。把类型收紧只会挡住合法厂商
 * —— `tool-loop.test.ts` 早就得写 `"fake" as ProviderId` 才绕得过去。
 *
 * 拼错的 provider 由 `resolveBaseUrl` 在调用时抛出可读错误（不是在这里拦住）。
 */
export type ProviderId = string;

/** 精选短名单（**不是全集**；seed 默认值、控制台下拉、文档示例用它） */
export const PROVIDER_IDS: readonly ProviderId[] = [
  "deepseek",
  "openai",
  "anthropic",
  "openrouter",
  "custom",
];

/**
 * Profile —— remember-api 的核心实体。
 * 客户端请求中的 `model` 字段即 Profile 的 `name`。
 */
export interface Profile {
  id: string;
  userId: string;
  /** 客户端使用的模型名，如 `zero-dev` */
  name: string;
  provider: ProviderId;
  /** 底层基础模型，如 `deepseek-chat` */
  model: string;
  projectId: string | null;
  systemPrompt: string | null;
  memoryEnabled: boolean;
  /** 单次请求 Memory Token 上限 */
  memoryBudget: number;
  skillIds: string[];
  temperature: number | null;
  maxTokens: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  summary: string | null;
  architecture: string | null;
  status: string | null;
  /** 重要设计决策及原因 */
  decisions: string[];
  /** 已知问题 */
  knownIssues: string[];
  /** 独立记忆命名空间，用于项目隔离 */
  memoryNamespace: string;
  createdAt: string;
  updatedAt: string;
}

export interface Skill {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  content: string;
  tokenCount: number;
  createdAt: string;
  updatedAt: string;
}

/** 一条记忆（Hermes / 本地存储均需转换为该统一结构） */
export interface Memory {
  id: string;
  userId: string;
  /** null = 用户级全局记忆 */
  projectId: string | null;
  type: MemoryType;
  content: string;
  /** 0~1，重要性越高越难被裁剪 */
  importance: number;
  pinned: boolean;
  /** 来源说明：user / auto / model-name */
  source: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKey {
  id: string;
  userId: string;
  name: string;
  /** 展示用短前缀，如 `rma_abc1` */
  prefix: string;
  /** 明文 Key 的末 4 位，仅用于识别 */
  last4: string;
  /** Key 的哈希值，绝不返回给客户端 */
  hash: string;
  disabled: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface ProviderConfig {
  id: string;
  userId: string;
  provider: ProviderId;
  baseUrl: string | null;
  defaultModel: string | null;
  /** 加密存储的用户 Provider Key，绝不返回给客户端 */
  apiKeyEncrypted: string;
  isConnected: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RequestUsage {
  id: string;
  userId: string;
  profileId: string;
  projectId: string | null;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  memoryTokens: number;
  skillTokens: number;
  latencyMs: number;
  estimatedCost: number;
  createdAt: string;
}
