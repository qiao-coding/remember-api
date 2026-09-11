/**
 * 构建期把 `@remember/db` 的 Supabase 根 CA 拷进 api 包。
 *
 * 为什么需要：`packages/db/src/client.ts` 的 `loadCa()` 按「相对自身位置的
 * `../certs/supabase-ca.pem`」找根 CA。`@remember/db` 被 tsup 用 `noExternal`
 * 打进 `dist/index.js` 之后，那个「自身位置」从 `packages/db/src/` 变成了
 * `apps/api/dist/`，于是相对路径落到 **`apps/api/certs/supabase-ca.pem`**——
 * 而 `apps/api` 下根本没有 certs/，`loadCa()` 静默返回 undefined，
 * 结果就是连 Supabase 报 `self-signed certificate in certificate chain`。
 *
 * 症状特别有迷惑性：`pnpm dev`（tsx，直接从 packages/db/src 加载）**是好的**，
 * 只有产物坏——所以「开发机上好好的，一打包就连不上云端」。
 *
 * 路径通过 pnpm 的 `node_modules/@remember/db` 符号链接解析，不硬编码仓库布局，
 * 也不含用户名绝对路径。与 `apps/cli/scripts/copy-assets.mjs` 同源，那里还多拷一份
 * `drizzle/`（CLI 要跑迁移）；api 运行时不做迁移，故只要 certs。
 */
import { cpSync, existsSync, realpathSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(realpathSync(join(pkgRoot, "node_modules", "@remember", "db")), "certs");
const to = join(pkgRoot, "certs");

if (!existsSync(from)) {
  console.warn(`⚠️  跳过（源不存在）: ${from}`);
  process.exit(0);
}
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
console.log(`✅ ${from} → ${to}`);
