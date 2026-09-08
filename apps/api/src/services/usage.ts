import { getDb, requestUsage } from "@remember/db";
import { newId } from "@remember/shared";
import { estimateCost } from "../lib/cost.js";

export interface UsageRecord {
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
}

/** 每次请求落一条用量记录（含成本估算） */
export async function recordUsage(record: UsageRecord): Promise<void> {
  try {
    await getDb().insert(requestUsage).values({
      id: newId("usage"),
      userId: record.userId,
      profileId: record.profileId,
      projectId: record.projectId,
      provider: record.provider,
      model: record.model,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      cachedTokens: record.cachedTokens,
      memoryTokens: record.memoryTokens,
      skillTokens: record.skillTokens,
      latencyMs: record.latencyMs,
      estimatedCost: estimateCost(
        record.provider,
        record.model,
        record.inputTokens,
        record.cachedTokens,
        record.outputTokens,
      ),
    });
  } catch (err) {
    // 用量记录失败不应阻断主链路
    console.error("[usage] 记录失败:", err);
  }
}
