/**
 * 直接向 Supabase auth.users 插入已激活用户（绕过 GoTrue 邮件确认）。
 * 用于 dev/e2e：GoTrue signup 在 Confirm email 开启时只能建未激活用户。
 *
 * 用法：
 *   SUPABASE_DB_URL=<session pooler 串> EMAIL=<email> PASSWORD=<pw> pnpm create-user
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const HERE = dirname(fileURLToPath(import.meta.url));
const ca = readFileSync(join(HERE, "..", "certs", "supabase-ca.pem"), "utf8");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`❌ ${name} 未设置`);
    process.exit(1);
  }
  return value;
}

const url = requireEnv("SUPABASE_DB_URL");
const email = requireEnv("EMAIL").toLowerCase();
const password = requireEnv("PASSWORD");

async function main() {
  const sql = postgres(url, {
    ssl: { rejectUnauthorized: true, ca },
    prepare: false,
    connect_timeout: 10,
  });
  try {
    const existing = await sql`select id from auth.users where email = ${email}`;
    let uid: string;
    if (existing.length > 0) {
      uid = existing[0]!.id;
      // 修复旧脚本建的残缺行：instance_id 必须是 nil UUID，token 列不能是 NULL
      await sql`
        update auth.users set
          instance_id = '00000000-0000-0000-0000-000000000000',
          email_confirmed_at = coalesce(email_confirmed_at, now()),
          confirmation_token = coalesce(confirmation_token, ''),
          recovery_token = coalesce(recovery_token, ''),
          email_change = coalesce(email_change, ''),
          email_change_token_new = coalesce(email_change_token_new, ''),
          email_change_token_current = coalesce(email_change_token_current, ''),
          phone_change = coalesce(phone_change, ''),
          phone_change_token = coalesce(phone_change_token, '')
        where id = ${uid}
      `;
    } else {
      const [user] = await sql`
        insert into auth.users (
          id, instance_id, aud, role, email, encrypted_password,
          email_confirmed_at,
          confirmation_token, recovery_token,
          email_change, email_change_token_new, email_change_token_current,
          phone_change, phone_change_token,
          raw_app_meta_data, raw_user_meta_data,
          created_at, updated_at, is_sso_user, is_anonymous
        ) values (
          gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
          'authenticated', 'authenticated', ${email},
          crypt(${password}, gen_salt('bf', 10)),
          now(),
          '', '', '', '', '', '', '',
          '{"provider":"email","providers":["email"]}'::jsonb,
          '{"name":"Test User"}'::jsonb,
          now(), now(), false, false
        ) returning id
      `;
      if (!user) {
        throw new Error("插入 auth.users 未返回 id");
      }
      uid = user.id;
    }

    // 确保 identity 存在（上次运行可能只插了 users 没插 identities）
    const ident = await sql`
      select id from auth.identities where user_id = ${uid} and provider = 'email'
    `;
    if (ident.length === 0) {
      // email 列是生成列（identity_data->>'email'），不能直接插
      await sql`
        insert into auth.identities (
          id, provider_id, user_id, identity_data, provider,
          last_sign_in_at, created_at, updated_at
        ) values (
          gen_random_uuid(), ${uid}::text, ${uid},
          jsonb_build_object('sub', ${uid}::text, 'email', ${email}::text, 'email_verified', true),
          'email', now(), now(), now()
        )
      `;
    }
    console.log(`✅ 用户已就绪: ${email} (${uid})`);
  } catch (e) {
    console.error("❌ 创建失败:", e instanceof Error ? e.message.split("\n")[0] : String(e));
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

main();
