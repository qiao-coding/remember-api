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
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .optional()
    .default("info"),
});

export type Env = z.infer<typeof EnvSchema>;

export const env: Env = EnvSchema.parse(process.env);
