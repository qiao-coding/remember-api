/**
 * 从「ref + 区域 + 密码」推出一对池化连接串 —— 这是整条云端安装路的**命门**。
 *
 * 为什么是试而不是算：池化主机名里的集群前缀（`aws-0-` / `aws-1-`）推不出来，
 * 同一区域两种前缀都存在。所以「按候选依次真连一次」不是权宜之计而是唯一确定的做法，
 * 也因此这里的测试全是关于**顺序、候选、以及判定依据**的：
 *  - 试的必须是 5432（session 池），不是 6543 —— 语义最干净的那个才是判据；
 *  - 试的顺序必须是 aws-0 → aws-1，且第一个通的就是答案（不该继续试）；
 *  - 两条串要成对给出，端口不能一样，否则「跑得起来但迁移全挂」。
 *
 * 探针是注入的（`opts.probe`），所以这里测的是推导逻辑本身，不碰网络。
 */
import { describe, expect, it, vi } from "vitest";
import { derivePoolerConnection, poolerUrl } from "./supabase-connect.js";

const REF = "abcdefghijklmnopqrst";
const REGION = "us-east-1";
const PW = "s3cret-pw";

/** 探针：按给定的「通 / 不通」答案作答，并记下试过哪些 URL */
function probeStub(answers: Record<string, boolean>) {
  const tried: string[] = [];
  const probe = vi.fn(async (url: string) => {
    tried.push(url);
    // 按 hostname 查（`.host` 带端口，会把同一台主机的两个端口当成两个 key）
    const host = new URL(url).hostname;
    return answers[host] ? { ok: true } : { ok: false, error: "认证失败" };
  });
  return { probe, tried };
}

describe("poolerUrl：拼串时最容易错的三段（用户名 / 转义 / 端口）", () => {
  it("用户名必须带 ref —— 裸 postgres 会得到 no tenant identifier，报错长得像密码错", () => {
    const url = poolerUrl("aws-0-us-east-1.pooler.supabase.com", 6543, REF, PW);

    expect(decodeURIComponent(new URL(url).username)).toBe(`postgres.${REF}`);
  });

  it("密码里的 @ / # / 斜杠要被转义，不然会把主机名截断", () => {
    const url = poolerUrl("aws-0-us-east-1.pooler.supabase.com", 6543, REF, "p@ss/w#rd?x");

    expect(new URL(url).password).toBe(encodeURIComponent("p@ss/w#rd?x"));
    expect(new URL(url).hostname).toBe("aws-0-us-east-1.pooler.supabase.com");
  });

  it("事务池 6543 带 pgbouncer=true；session 池 5432 不带（那不是同一件事）", () => {
    const tx = new URL(poolerUrl("h", 6543, REF, PW)).searchParams;
    expect(tx.get("pgbouncer")).toBe("true");
    expect(tx.get("sslmode")).toBe("require");

    const session = new URL(poolerUrl("h", 5432, REF, PW)).searchParams;
    expect(session.get("pgbouncer")).toBeNull();
    expect(session.get("sslmode")).toBe("require");
  });
});

describe("derivePoolerConnection：试出来的，不是猜出来的", () => {
  it("第一个候选就通 → 两条串成对给出，端口各就各位", async () => {
    const { probe, tried } = probeStub({ [`aws-0-${REGION}.pooler.supabase.com`]: true });

    const res = await derivePoolerConnection({ ref: REF, region: REGION, password: PW, probe });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.conn.host).toBe(`aws-0-${REGION}.pooler.supabase.com`);
      // 运行时是事务池，迁移是 session 池 —— 用反了 DDL 必挂
      expect(new URL(res.conn.url).port).toBe("6543");
      expect(new URL(res.conn.migrateUrl).port).toBe("5432");
      expect(new URL(res.conn.migrateUrl).searchParams.get("pgbouncer")).toBeNull();
    }
    expect(probe).toHaveBeenCalledTimes(1);
    expect(tried).toHaveLength(1);
  });

  it("判定依据是 **5432** 那条 —— session 池语义最干净，不带事务池的会话复用行为", async () => {
    const { probe, tried } = probeStub({ [`aws-0-${REGION}.pooler.supabase.com`]: true });

    await derivePoolerConnection({ ref: REF, region: REGION, password: PW, probe });

    // 拿 6543 当判据的话，「事务池认不认这个租户」和「这密码对不对」两件事会混在一起
    expect(new URL(tried[0] as string).port).toBe("5432");
  });

  it("aws-0 不通 → 退 aws-1，顺序不能反（aws-0 是更常见的那一半）", async () => {
    const { probe, tried } = probeStub({ [`aws-1-${REGION}.pooler.supabase.com`]: true });

    const res = await derivePoolerConnection({ ref: REF, region: REGION, password: PW, probe });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.conn.host).toBe(`aws-1-${REGION}.pooler.supabase.com`);
    expect(tried.map((u) => new URL(u).hostname)).toEqual([
      `aws-0-${REGION}.pooler.supabase.com`,
      `aws-1-${REGION}.pooler.supabase.com`,
    ]);
  });

  it("两个都试完还不通 → 把「试过哪些、各自报了什么」原样带回，不猜原因", async () => {
    // 主机不存在、密码不对、项目被暂停，表现都是连不上，这里分辨不了 ——
    // 硬猜一个原因会把用户往错方向带（这正是老注释里那句错的「出口被挡」的教训）。
    const { probe } = probeStub({});

    const res = await derivePoolerConnection({ ref: REF, region: REGION, password: PW, probe });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.tried).toHaveLength(2);
      expect(res.tried.join("\n")).toContain(`aws-0-${REGION}`);
      expect(res.tried.join("\n")).toContain(`aws-1-${REGION}`);
      expect(res.tried.join("\n")).toContain("认证失败");
    }
  });

  it("项目缺 ref 或区域 → 当场返回，一次都不去试（推不出主机名，试也没意义）", async () => {
    const { probe } = probeStub({ [`aws-0-${REGION}.pooler.supabase.com`]: true });

    for (const bad of [
      { ref: "", region: REGION },
      { ref: REF, region: "" },
    ]) {
      const res = await derivePoolerConnection({ ...bad, password: PW, probe });
      expect(res.ok).toBe(false);
    }
    expect(probe).not.toHaveBeenCalled();
  });

  it("区域必须落在主机名里 —— 抄错区域是最容易发生的一种错", async () => {
    const { probe, tried } = probeStub({ [`aws-0-ap-northeast-1.pooler.supabase.com`]: true });

    await derivePoolerConnection({ ref: REF, region: "ap-northeast-1", password: PW, probe });

    for (const url of tried) expect(new URL(url).hostname).toContain("ap-northeast-1");
  });
});
