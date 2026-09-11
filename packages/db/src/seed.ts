/**
 * 种子数据 CLI 壳 —— 逻辑在 `seed-core.ts`（apps/cli 的本地向导复用同一份）。
 *
 * 用户不再由种子创建（用户来自 Supabase Auth），只需把 seed 指向其 auth uid。
 * 运行前需确保已执行迁移且 DATABASE_URL 可用。
 *
 * 用法：SEED_USER_ID=<supabase-uid> pnpm db:seed
 */
import { seedProviderWarning, seedUser } from "./seed-core.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`❌ ${name} 未设置`);
    process.exit(1);
  }
  return value;
}

requireEnv("DATABASE_URL");
const SEED_USER_ID = requireEnv("SEED_USER_ID");
const SEED_USER_EMAIL = process.env.SEED_USER_EMAIL ?? "admin@remember.local";
const SEED_USER_NAME = process.env.SEED_USER_NAME ?? "Admin";
const BOOTSTRAP_KEY = process.env.BOOTSTRAP_API_KEY ?? "rma_bootstrap_local";
const PEPPER = process.env.API_KEY_PEPPER ?? "change-me-in-production";

// 样例 Profile 的 provider/model —— 默认走 DeepSeek，换厂商只需改 env，不用改代码。
const SEED_PROVIDER = process.env.SEED_PROVIDER ?? "deepseek";
if (!SEED_PROVIDER.trim()) {
  console.error("❌ SEED_PROVIDER 不能为空");
  process.exit(1);
}
const providerWarning = seedProviderWarning(SEED_PROVIDER);
if (providerWarning) console.warn(`⚠️  ${providerWarning}`);
const SEED_MODEL = process.env.SEED_MODEL ?? "deepseek-chat";

async function main() {
  const result = await seedUser({
    userId: SEED_USER_ID,
    email: SEED_USER_EMAIL,
    name: SEED_USER_NAME,
    provider: SEED_PROVIDER,
    model: SEED_MODEL,
    pepper: PEPPER,
    bootstrapApiKey: BOOTSTRAP_KEY,
  });

  console.log(
    result.createdDemoData
      ? "✅ 样例数据写入完成"
      : "ℹ️  该用户已有样例项目，跳过样例数据（仅确保 bootstrap key 存在）",
  );
  if (!result.bootstrapProfileId) {
    console.warn("⚠️  未找到该用户的 profile，bootstrap key 无法绑定个人 model，将跳过");
  }

  console.log(`   用户: ${SEED_USER_EMAIL} (${SEED_USER_ID})`);
  console.log(`   引导 API Key: ${BOOTSTRAP_KEY}`);
  process.exit(0); // 一次性 CLI：显式退出，避免连接池 keep-alive 挂住进程
}

main().catch((err) => {
  console.error("❌ 种子失败:", err);
  process.exit(1);
});
