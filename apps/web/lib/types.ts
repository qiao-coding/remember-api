import type { Memory, MemoryType } from "@remember/shared";

export type { MemoryType };

/* Manager API 响应视图类型（与 apps/api routes/manager 对齐） */

export interface ProfileView {
  id: string;
  name: string;
  provider: string;
  model: string;
  projectId: string;
  projectName: string | null;
  systemPrompt: string | null;
  memoryEnabled: boolean;
  memoryBudget: number;
  skillIds: string[];
  temperature: number | null;
  maxTokens: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectView {
  id: string;
  name: string;
  description: string | null;
  summary: string | null;
  architecture: string | null;
  status: string | null;
  decisions: string[];
  knownIssues: string[];
  memoryNamespace: string;
  createdAt: string;
  updatedAt: string;
}

export interface SkillView {
  id: string;
  name: string;
  description: string | null;
  content: string;
  tokenCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface KeyView {
  id: string;
  name: string;
  /** 绑定的个人 model(profile)；一个 key 只能调用它绑的那一个 model（子 agent） */
  profileId: string;
  prefix: string;
  last4: string;
  disabled: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface KeyCreated {
  id: string;
  name: string;
  profileId: string;
  /** 明文 Key，仅创建成功这一次返回（数据库只存哈希） */
  key: string;
  prefix: string;
  last4: string;
}

export interface ProviderView {
  id: string;
  provider: string;
  baseUrl: string | null;
  defaultModel: string | null;
  isConnected: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryItem extends Memory {
  relevance?: number;
}

export interface UsageSummary {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  memoryTokens: number;
  skillTokens: number;
  cost: number;
  latencyMs: number;
  cacheHit: number;
  memoryOverhead: number;
  avgLatencyMs: number;
}

export interface UsageRow {
  id: string;
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

export interface UsageBreakdown {
  key: string;
  tokens: number;
  cost: number;
  requests: number;
}

export const MEMORY_TYPE_LABEL: Record<MemoryType, string> = {
  preference: "偏好",
  decision: "决策",
  status: "状态",
  task: "任务",
  issue: "问题",
  history: "历史",
};
