/**
 * vitest setup：env.ts 在 import 时执行 EnvSchema.parse，缺失 DATABASE_URL/SUPABASE_URL 即抛。
 * 这里先覆盖假 env（放真值也无意义——DB/Supabase 一律 vi.mock，绝不触真库）。
 * LOG_LEVEL 用枚举内值 "error"。
 */
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/remember_test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
process.env.API_KEY_PEPPER = "test-pepper";
process.env.ENCRYPTION_KEY = "test-encryption-key";
process.env.LOG_LEVEL = "error";
// 显式钉住上游凭据为空：env.ts 的 process.loadEnvFile() 会读 <cwd>/.env，开发机上的
// UPSTREAM_API_KEY 会悄悄决定测试走「env 兜底」还是「无凭据」分支。测试必须与开发机环境无关。
process.env.UPSTREAM_API_KEY = "";
process.env.UPSTREAM_BASE_URL = "";
