"use client";

import { Suspense, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Cloud, Gauge, Link2 } from "lucide-react";
import { createSupabaseBrowser } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/spinner";

// 官方 login-02 抓取时捕捉的 Prisma 棱镜 spectrum 渐变（品牌母题，用于细线点缀）。
const SPECTRUM =
  "linear-gradient(85deg,#01d7e4 0%,#f3c306 25%,#f37a03 50%,#f43531 74%,#f00e5c 100%)";

type Mode = "login" | "register";

const FEATURES: { icon: typeof Link2; title: string; desc: string }[] = [
  {
    icon: Link2,
    title: "同一份记忆，处处一致",
    desc: "Profile 关联的记忆与 Skills 对所有接入客户端共享。",
  },
  {
    icon: Cloud,
    title: "集中管理上游",
    desc: "Provider 的 API Key 集中保存，加密存于服务端、不在控制台回显。",
  },
  {
    icon: Gauge,
    title: "用量完全透明",
    desc: "token / 成本逐条可见，判断记忆到底值不值。",
  },
];

/** 品牌 mark：remember-api 官方 logo（public/brand/remember-logo.png）。 */
function LogoBlock({ className }: { className?: string }) {
  return (
    <Image
      src="/brand/remember-logo.png"
      alt=""
      width={24}
      height={24}
      className={`size-6 shrink-0 ${className ?? ""}`}
    />
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginView />
    </Suspense>
  );
}

function LoginView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>(
    searchParams.get("mode") === "register" ? "register" : "login",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const next = searchParams.get("next");

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setNotice(null);
    setLoading(false);
  };

  const go = () => {
    router.replace(next?.startsWith("/") ? next : "/dashboard");
    router.refresh();
  };

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const { error } = await createSupabaseBrowser().auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      go();
    } catch (err) {
      const code = (err as { code?: string })?.code;
      // 统一凭证错误文案，不区分邮箱/密码（安全）
      setError(
        code === "invalid_credentials" ? "邮箱或密码不正确" : "登录失败，请稍后重试",
      );
      setLoading(false);
    }
  }

  async function onRegister(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    if (password.length < 6) {
      setError("密码至少 6 位");
      return;
    }
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const { data, error } = await createSupabaseBrowser().auth.signUp({
        email,
        password,
      });
      if (error) throw error;
      if (data.session) {
        // 项目未开启邮箱确认：注册即登录
        go();
        return;
      }
      if (data.user) {
        // 开启了邮箱确认：账号已创建，待确认
        setMode("login");
        setNotice("账号已创建。确认邮件已发送，请查收后回来登录。");
        setPassword("");
        setLoading(false);
        return;
      }
      throw new Error("no_user");
    } catch (err) {
      const raw = err as { message?: string; code?: string };
      const msg = raw.message ?? "";
      setError(
        /already registered|email_exists/i.test(msg) ||
          raw.code === "email_exists"
          ? "该邮箱已注册，请直接登录"
          : /not allowed|disabled|for security/i.test(msg)
            ? "注册暂不可用（实例未开启注册）。已有账号请直接登录"
            : "注册失败，请稍后重试",
      );
      setLoading(false);
    }
  }

  const submitting = loading ? <Spinner /> : null;

  return (
    <main className="grid min-h-dvh lg:grid-cols-2">
      {/* 左：品牌 + 登录/注册表单（对齐 login-02 布局） */}
      <div className="flex flex-col gap-8 p-6 md:p-12">
        <Link
          href="/"
          className="flex w-fit items-center gap-2 font-medium"
          aria-label="remember-api 首页"
        >
          <LogoBlock className="size-6" />
          <span className="text-sm font-semibold tracking-tight">remember-api</span>
        </Link>

        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-xs">
            <div className="flex flex-col items-center gap-3 text-center">
              <h1 className="text-2xl font-bold tracking-tight">
                {mode === "login" ? "登录控制台" : "创建账号"}
              </h1>
              <p className="text-balance text-sm text-muted-foreground">
                {mode === "login"
                  ? "邮箱 + 密码登录单用户实例"
                  : "首次使用？创建一个账号即可进入"}
              </p>

              {/* 登录 / 注册 切换 */}
              <div
                role="tablist"
                aria-label="登录或注册"
                className="flex w-full max-w-[220px] rounded-lg bg-muted p-0.5"
              >
                {(
                  [
                    { key: "login", label: "登录" },
                    { key: "register", label: "注册账号" },
                  ] as { key: Mode; label: string }[]
                ).map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={mode === t.key}
                    onClick={() => switchMode(t.key)}
                    className={cn(
                      "h-7 flex-1 rounded-md text-xs font-medium transition-all",
                      mode === t.key
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <form
              onSubmit={mode === "login" ? onLogin : onRegister}
              className="mt-6 flex flex-col gap-5"
              noValidate
            >
              <div className="space-y-1.5">
                <Label htmlFor="email">邮箱</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  autoFocus
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">密码</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder={mode === "register" ? "至少 6 位" : "••••••••"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  minLength={mode === "register" ? 6 : undefined}
                  required
                />
              </div>

              {notice ? (
                <p
                  role="status"
                  className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-primary"
                >
                  {notice}
                </p>
              ) : null}

              {error ? (
                <p
                  role="alert"
                  className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                >
                  {error}
                </p>
              ) : null}

              <Button type="submit" className="h-10 w-full" disabled={loading}>
                {loading
                  ? mode === "login"
                    ? (
                        <>
                          {submitting} 登录中…
                        </>
                      )
                    : (
                        <>
                          {submitting} 创建中…
                        </>
                      )
                  : mode === "login"
                    ? "进入控制台"
                    : "创建账号并进入"}
              </Button>
            </form>

            {mode === "login" ? (
              <p className="mt-4 text-center text-xs text-muted-foreground">
                还没有账号？{" "}
                <button
                  type="button"
                  onClick={() => switchMode("register")}
                  className="font-medium text-foreground underline underline-offset-4 transition-colors hover:text-primary"
                >
                  注册一个
                </button>
              </p>
            ) : null}
          </div>
        </div>

        <p className="hidden text-center text-[11px] text-muted-foreground sm:block">
          remember-api · Stateful Personal AI
        </p>
      </div>

      {/* 右：品牌带（login-02 右侧 image band，用产品要点面板实现，Prisma 质感） */}
      <div className="relative hidden overflow-hidden border-l border-border bg-muted lg:block">
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-[3px]"
          style={{ backgroundImage: SPECTRUM }}
        />
        <div className="flex h-full flex-col justify-center gap-10 p-12 xl:p-16">
          <div>
            <h2 className="text-balance text-2xl font-semibold tracking-tight">
              一条网关，持续记忆的 AI
            </h2>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
              OpenAI 兼容网关。Claude Code / Codex / Cursor 一处接入，
              记忆、Skills 与偏好跨设备一致。
            </p>
          </div>

          <ul className="space-y-6">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex items-start gap-3.5">
                <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10">
                  <f.icon className="size-4 text-primary" />
                </span>
                <div>
                  <p className="text-sm font-semibold">{f.title}</p>
                  <p className="mt-1 max-w-sm text-sm text-muted-foreground">{f.desc}</p>
                </div>
              </li>
            ))}
          </ul>

          <div
            aria-hidden
            className="h-[2px] w-16 rounded-full"
            style={{ backgroundImage: SPECTRUM }}
          />
        </div>
      </div>
    </main>
  );
}
