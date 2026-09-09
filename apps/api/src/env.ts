import { z } from "zod";

// Node 22 内置 .env 加载（cwd 为包目录时读 apps/api/.env；已有环境变量优先，不覆盖）
try {
  process.loadEnvFile();
} catch {
  // 无 .env 文件时跳过（如生产环境直接注入环境变量）
}

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL 必填"),
  // auth 模块与 api 网关解耦：SUPABASE_URL 为空 = 网关-only 模式（仅 /v1 + /health，不挂 /api 管理路由）
  SUPABASE_URL: z.string().optional().default(""),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().default(""),
  DEEPSEEK_API_KEY: z.string().optional().default(""),
  DEEPSEEK_BASE_URL: z.string().optional().default("https://api.deepseek.com"),
  MEM0_BASE_URL: z.string().optional().default(""),
  MEM0_API_KEY: z.string().optional().default(""),
  API_KEY_PEPPER: z.string().optional().default("change-me-in-production"),
  ENCRYPTION_KEY: z.string().optional().default("change-me-in-production"),
  PORT: z.coerce.number().optional().default(4000),
  HOST: z.string().optional().default("0.0.0.0"),
  // ── 长对话 LLM 归档（全部可选带默认，不配即归档关闭路径仍安全）──
  // thresholdTokens：累计对话 token 到这个值才触发归档（demo 可调小，如 1500）
  ARCHIVE_THRESHOLD_TOKENS: z.coerce.number().optional().default(6000),
  // growthRatio：同一对话距上次归档增长 ≥ ratio×threshold 才再次归档（默认 1 = 每满一档归档一次）
  ARCHIVE_GROWTH_RATIO: z.coerce.number().optional().default(1),
  // 每次喂给提炼的转写上限（丢最旧）
  ARCHIVE_MAX_TRANSCRIPT_TOKENS: z.coerce.number().optional().default(6000),
  // 单次归档最多提炼条数
  ARCHIVE_MAX_ITEMS: z.coerce.number().optional().default(12),
  // 归档提炼用模型（默认网关同款）
  ARCHIVE_MODEL: z.string().optional().default("deepseek-chat"),
  // ── recent 高密度会话摘要（profile 隔离，跨会话交接块）──
  // minTokens：会话累计到这个值才首产摘要；growthTokens：距上次摘要增长到这值才滚动刷新；
  // maxTranscriptTokens：喂提炼的转写上限（丢最旧）；maxInjectTokens：注入摘要 token 上限
  RECENT_MIN_TOKENS: z.coerce.number().optional().default(1000),
  RECENT_GROWTH_TOKENS: z.coerce.number().optional().default(800),
  RECENT_MAX_TRANSCRIPT_TOKENS: z.coerce.number().optional().default(3000),
  RECENT_MAX_INJECT_TOKENS: z.coerce.number().optional().default(300),
  // ── 工具型自主 recall（网关内 agentic loop）──
  // 关闭后回退旧被动检索注入；上游端点不支持 tools 时网关自动降级去 tools 重发，无需手动关。
  // 不用 z.coerce.boolean：它把字符串 "false" 转 true，无法真正关闭 → preprocess 先译字符串
  RECALL_TOOLS: z.preprocess(
    (v) => (typeof v === "string" ? v === "true" : v),
    z.boolean().default(true),
  ),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .optional()
    .default("info"),
});

export type Env = z.infer<typeof EnvSchema>;

export const env: Env = EnvSchema.parse(process.env);
