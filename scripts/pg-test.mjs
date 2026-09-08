import postgres from "postgres";

const url = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/remember_api";
console.log("connecting:", url);
const sql = postgres(url, { prepare: false, connect_timeout: 5 });
const started = Date.now();
try {
  const r = await sql`select 1 as ok`;
  console.log("connected in", Date.now() - started, "ms →", r);
} catch (err) {
  console.error("CONN FAIL:", err?.message ?? err);
}
await sql.end().catch(() => {});
process.exit(0);
