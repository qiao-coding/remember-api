export * from "./schema.js";
export {
  getDb,
  createDb,
  createClient,
  closeDb,
  type Db,
  type ClientOptions,
} from "./client.js";
export * from "./provider-config.js";
export { listProfiles, setProfilesTarget } from "./profile.js";
export { listApiKeys, createApiKey, type CreateApiKeyInput, type ApiKeyRow } from "./api-key.js";
// 本地部署路径（apps/cli 的 init 向导用）：脚本壳 migrate.ts / seed.ts 调的也是这两个
export { runMigrations } from "./migrate-core.js";
export {
  seedUser,
  seedProviderWarning,
  type SeedUserOptions,
  type SeedUserResult,
} from "./seed-core.js";
