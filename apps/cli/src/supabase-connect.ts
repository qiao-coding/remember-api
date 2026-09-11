/**
 * 从「项目 ref + 区域 + 密码」推出一对能用的池化连接串。
 *
 * 为什么是**试**而不是**算**：池化主机名里的集群前缀（`aws-0-` / `aws-1-`）推不出来 ——
 * 同一个区域两种前缀都存在（实测 `aws-0-us-east-1` 与 `aws-1-us-east-1` 都有 A 记录），
 * 而哪个属于这个项目只有 Supabase 自己知道。所以按候选依次真连一次，**认证通过的那个就是答案**。
 * 这不是猜测：连上了就是连上了。
 *
 * 密码是这里唯一躲不掉的输入 —— 它只在 Supabase 侧生成与保存，任何拿连接串的路径都要它
 * （Dashboard 要、`supabase link -p` 要、直连当然也要）。区别只在于：**建新项目时密码是我们
 * 生成的**，所以那条路用户一个字符都不用敲。
 *
 * 另一条被否掉的路：`supabase link` 会把池化串写进 `supabase/.temp/pooler-url`。它需要先在
 * 一次性目录里 `supabase init` 出脚手架、依赖一个没写进文档的临时文件格式，而换来的信息
 * （主机名）用一次试连就得到了 —— 还顺带验证了密码。少一层脆的依赖。
 */
import { POOLER_SESSION_PORT, POOLER_TRANSACTION_PORT, probe } from "./db.js";

/** 池化集群前缀的候选，按顺序试。目前世界上只有这两种 */
const CANDIDATE_PREFIXES = ["aws-0", "aws-1"];

export interface DerivedConnection {
  /** 运行时串：事务池 6543（网关连这条） */
  url: string;
  /** 迁移串：session 池 5432（DDL 必须走这条，事务池跑不了） */
  migrateUrl: string;
  /** 试出来的池化主机，例：`aws-0-us-east-1.pooler.supabase.com` */
  host: string;
}

export interface PoolerProbe {
  ref: string;
  region: string;
  password: string;
  /** 试连上限（秒），默认 8 —— 跨洋握手加密码校验够了 */
  connectTimeout?: number;
  /** 测试注入；默认走 `db.ts` 的探针（与网关同源的 SSL/根 CA 判定） */
  probe?: (url: string) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * 拼一条池化连接串。
 *
 * 用户名**必须**带项目 ref（`postgres.<ref>`）：Supavisor 靠它路由租户，裸 `postgres`
 * 得到的是一句 `no tenant identifier provided` —— 那报错看着像密码错，极难自查。
 * 密码走 `encodeURIComponent`：Supabase 生成的密码可能带 `@` `/` `#` 这类字符，
 * 直接拼进 URL 会把主机名截断。
 */
export function poolerUrl(
  host: string,
  port: number,
  ref: string,
  password: string,
): string {
  const user = encodeURIComponent(`postgres.${ref}`);
  const pw = encodeURIComponent(password);
  // 事务池要告诉驱动别用预处理语句（postgres-js 侧另有 prepare:false，两边是同一件事）
  const query = port === POOLER_TRANSACTION_PORT ? "pgbouncer=true&sslmode=require" : "sslmode=require";
  return `postgres://${user}:${pw}@${host}:${port}/postgres?${query}`;
}

export type DeriveResult =
  | { ok: true; conn: DerivedConnection }
  | { ok: false; tried: string[] };

/**
 * 依次试候选前缀，第一个连上的就是它。
 *
 * 试的是 **5432（session 池）**：它语义最简单（没有事务池的会话复用行为），
 * 判定「这个集群认不认这个租户」最干净。同一个集群的 6543 自然也通，两条串一起给出去。
 *
 * 全试完还是不通时**不猜原因**：主机不存在、密码不对、项目被暂停，表现都是连不上，
 * 这里分辨不了，所以把「试过哪些 + 各自报了什么」原样带回给调用方去说。
 */
export async function derivePoolerConnection(opts: PoolerProbe): Promise<DeriveResult> {
  const { ref, region, password } = opts;
  if (!ref || !region) return { ok: false, tried: ["项目缺 ref 或区域，推不出池化主机名"] };

  const check = opts.probe ?? ((url: string) => probe(url));
  const tried: string[] = [];

  for (const prefix of CANDIDATE_PREFIXES) {
    const host = `${prefix}-${region}.pooler.supabase.com`;
    const sessionUrl = poolerUrl(host, POOLER_SESSION_PORT, ref, password);
    const res = await check(sessionUrl);
    if (res.ok) {
      return {
        ok: true,
        conn: {
          url: poolerUrl(host, POOLER_TRANSACTION_PORT, ref, password),
          migrateUrl: sessionUrl,
          host,
        },
      };
    }
    tried.push(`${host}：${res.error ?? "连不上"}`);
  }

  return { ok: false, tried };
}
