"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowUpRight,
  BrainCircuit,
  CircleAlert,
  Clock3,
  DatabaseZap,
  Gauge,
  KeyRound,
  Layers3,
  Radio,
  Sparkles,
  WalletCards,
} from "lucide-react";
import {
  useKeys,
  useProfiles,
  useProjects,
  useProviders,
  useUsageSummary,
} from "@/lib/queries";
import { formatCost, formatInt, formatRelative } from "@/lib/format";
import type {
  KeyView,
  ProfileView,
  ProjectView,
  ProviderView,
} from "@/lib/types";
import { StatCard } from "@/components/stat-card";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { Stagger } from "@/components/stagger";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

const DAYS = 7;

export default function DashboardPage() {
  const summary = useUsageSummary(DAYS);
  const profiles = useProfiles();
  const projects = useProjects();
  const keys = useKeys();
  const providers = useProviders();

  const s = summary.data;
  const loading = summary.isLoading && !summary.data;
  const hasProvider = (providers.data ?? []).some((provider) => provider.isConnected);
  const hasProfile = !!profiles.data?.length;
  const hasKey = (keys.data ?? []).some((key) => !key.disabled);
  const nextActions = [
    {
      label: "创建 Profile",
      done: hasProfile,
      href: "/profiles",
      text: "让客户端可以用 model 名选择记忆配置。",
    },
    {
      label: "配置 Provider",
      done: hasProvider,
      href: "/providers",
      text: "保存上游模型 key，调用才能真正转发。",
    },
    {
      label: "生成 API Key",
      done: hasKey,
      href: "/keys",
      text: "把网关密钥复制到 Claude Code、Codex 或 Cursor。",
    },
  ];
  const readyCount = nextActions.filter((item) => item.done).length;

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm">
        <div className="grid lg:grid-cols-[1fr_360px]">
          <div className="relative min-h-[300px] overflow-hidden bg-[#0a0f16] p-5 text-white sm:p-7">
            <div className="absolute inset-0 opacity-70">
              <div className="absolute -right-20 -top-28 h-72 w-72 rounded-full bg-cyan-400/18 blur-3xl" />
              <div className="absolute bottom-0 left-12 h-48 w-72 rounded-full bg-amber-400/14 blur-3xl" />
              <div className="absolute inset-x-0 bottom-0 h-px bg-[linear-gradient(90deg,transparent,rgba(25,184,168,0.8),transparent)]" />
            </div>
            <div className="relative flex h-full flex-col">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-emerald-400/15 text-emerald-200 hover:bg-emerald-400/15">
                  <Radio className="size-3" />
                  {readyCount === 3 ? "网关可用" : `${readyCount}/3 已配置`}
                </Badge>
                <Badge className="bg-white/10 text-white/68 hover:bg-white/10">
                  近 {DAYS} 天
                </Badge>
              </div>
              <div className="mt-7 max-w-2xl">
                <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">
                  这里是你的 AI 记忆网关工作台
                </h1>
                <p className="mt-4 max-w-xl text-sm leading-7 text-white/62 sm:text-base">
                  先确认 Profile、Provider 和 API Key 是否就绪，再看 token、成本与记忆开销。每天打开这里，应当能立刻判断系统是否能用、哪里需要处理。
                </p>
              </div>
              <div className="mt-auto grid gap-3 pt-8 sm:grid-cols-3">
                <ConsoleChip
                  icon={BrainCircuit}
                  label="Profiles"
                  value={profiles.data?.length ?? 0}
                  loading={profiles.isLoading && !profiles.data}
                />
                <ConsoleChip
                  icon={KeyRound}
                  label="Active Keys"
                  value={(keys.data ?? []).filter((key) => !key.disabled).length}
                  loading={keys.isLoading && !keys.data}
                />
                <ConsoleChip
                  icon={DatabaseZap}
                  label="Providers"
                  value={(providers.data ?? []).filter((provider) => provider.isConnected).length}
                  loading={providers.isLoading && !providers.data}
                />
              </div>
            </div>
          </div>

          <aside className="border-t bg-background p-5 lg:border-l lg:border-t-0">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">接入检查</p>
                <p className="mt-1 text-xs text-muted-foreground">按这个顺序完成配置</p>
              </div>
              <Gauge className="size-5 text-primary" />
            </div>
            <div className="mt-4 space-y-3">
              {nextActions.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className="group flex gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-accent/50"
                >
                  <span
                    className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${
                      item.done
                        ? "bg-emerald-500/15 text-emerald-500"
                        : "bg-amber-500/15 text-amber-500"
                    }`}
                  >
                    {item.done ? <Sparkles className="size-3.5" /> : <CircleAlert className="size-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2 text-sm font-medium">
                      {item.label}
                      <ArrowUpRight className="size-3.5 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">{item.text}</span>
                  </span>
                </Link>
              ))}
            </div>
          </aside>
        </div>
      </section>

      {summary.isError ? (
        <ErrorState
          message="用量汇总加载失败，请确认后端服务可用"
          onRetry={() => void summary.refetch()}
          compact
        />
      ) : (
        <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="请求数"
            value={s ? formatInt(s.requests) : "—"}
            sub="近 7 天"
            loading={loading}
            icon={Activity}
          />
          <StatCard
            label="Tokens"
            value={s ? formatInt(s.inputTokens + s.outputTokens) : "—"}
            sub={
              s
                ? `${formatInt(s.inputTokens)} in · ${formatInt(s.outputTokens)} out${
                    s.cachedTokens ? ` · ${formatInt(s.cachedTokens)} cached` : ""
                  }`
                : undefined
            }
            loading={loading}
            icon={Layers3}
          />
          <StatCard
            label="估算成本"
            value={s ? formatCost(s.cost) : "—"}
            sub={s ? "近 7 天" : undefined}
            loading={loading}
            accent={!!s && s.cost > 0}
            icon={WalletCards}
          />
          <StatCard
            label="平均延迟"
            value={s ? `${s.avgLatencyMs.toFixed(0)} ms` : "—"}
            sub={s ? `memory overhead ${formatInt(s.memoryOverhead)} tokens` : undefined}
            loading={loading}
            icon={Clock3}
          />
        </Stagger>
      )}

      <Stagger className="grid grid-cols-1 gap-4 xl:grid-cols-2" delay={0.05}>
        <Panel
          title="Profiles"
          to="/profiles"
          error={
            profiles.isError ? (
              <PanelError onRetry={() => void profiles.refetch()} />
            ) : undefined
          }
          empty={
            profiles.data?.length ? undefined : (
              <PanelEmpty
                title="还没有 Profile"
                action={<LinkButton href="/profiles">去创建第一个 model</LinkButton>}
              />
            )
          }
        >
          {loadingList(profiles.isLoading && !profiles.data)}
          {(profiles.data ?? []).slice(0, 5).map((p) => (
            <ProfileRow key={p.id} p={p} />
          ))}
        </Panel>

        <Panel
          title="API Keys"
          to="/keys"
          error={keys.isError ? <PanelError onRetry={() => void keys.refetch()} /> : undefined}
          empty={
            keys.data?.length ? undefined : (
              <PanelEmpty title="还没有 API Key" action={<LinkButton href="/keys">创建</LinkButton>} />
            )
          }
        >
          {loadingList(keys.isLoading && !keys.data)}
          {(keys.data ?? []).slice(0, 5).map((k) => (
            <KeyRow key={k.id} k={k} />
          ))}
        </Panel>

        <Panel
          title="Projects"
          to="/projects"
          error={
            projects.isError ? (
              <PanelError onRetry={() => void projects.refetch()} />
            ) : undefined
          }
          empty={
            projects.data?.length ? undefined : (
              <PanelEmpty title="还没有 Project" action={<LinkButton href="/projects">创建</LinkButton>} />
            )
          }
        >
          {loadingList(projects.isLoading && !projects.data)}
          {(projects.data ?? []).slice(0, 5).map((p) => (
            <ProjectRow key={p.id} p={p} />
          ))}
        </Panel>

        <Panel
          title="Providers"
          to="/providers"
          error={
            providers.isError ? (
              <PanelError onRetry={() => void providers.refetch()} />
            ) : undefined
          }
          empty={
            providers.data?.length ? undefined : (
              <PanelEmpty
                title="尚未配置 Provider"
                description="配置 DeepSeek key 以启用调用"
                action={<LinkButton href="/providers">去配置</LinkButton>}
              />
            )
          }
        >
          {loadingList(providers.isLoading && !providers.data)}
          {(providers.data ?? []).map((pv) => (
            <ProviderRow key={pv.id} pv={pv} />
          ))}
        </Panel>
      </Stagger>
    </div>
  );
}

function Panel({
  title,
  to,
  children,
  empty,
  error,
}: {
  title: string;
  to: string;
  children: React.ReactNode;
  empty?: React.ReactNode;
  error?: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col overflow-hidden rounded-lg shadow-none">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        <Button asChild variant="ghost" size="sm" className="gap-1 text-muted-foreground">
          <Link href={to}>
            查看全部
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </CardHeader>
      <Separator />
      <CardContent className="flex-1 pt-2">
        {error ?? empty ?? <ul className="divide-y">{children}</ul>}
      </CardContent>
    </Card>
  );
}

function PanelEmpty({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return <EmptyState title={title} description={description} action={action} compact />;
}

function PanelError({ onRetry }: { onRetry: () => void }) {
  return (
    <ErrorState message="该面板加载失败，请确认后端服务可用" onRetry={onRetry} compact />
  );
}

function LinkButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Button asChild variant="outline" size="sm">
      <Link href={href}>{children}</Link>
    </Button>
  );
}

function loadingList(show: boolean) {
  return show
    ? Array.from({ length: 3 }).map((_, i) => (
        <li key={i} className="flex items-center justify-between gap-2 py-2.5">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-14" />
        </li>
      ))
    : null;
}

function ListItem({
  title,
  titleClassName = "",
  sub,
  right,
}: {
  title: React.ReactNode;
  titleClassName?: string;
  sub?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className={`truncate text-sm ${titleClassName}`}>{title}</p>
        {sub ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</p> : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </li>
  );
}

function ProfileRow({ p }: { p: ProfileView }) {
  return (
    <ListItem
      title={<span className="font-mono text-xs font-medium">{p.name}</span>}
      sub={`${p.provider}/${p.model}`}
      right={
        p.projectName ? (
          <Badge variant="secondary">{p.projectName}</Badge>
        ) : (
          <Badge variant="outline">未绑定项目</Badge>
        )
      }
    />
  );
}

function KeyRow({ k }: { k: KeyView }) {
  return (
    <ListItem
      title={<span className="font-mono text-xs">{k.prefix}…{k.last4}</span>}
      sub={k.name}
      right={
        <Badge variant={k.disabled ? "secondary" : "success"}>
          {k.disabled ? "已禁用" : "启用中"}
        </Badge>
      }
    />
  );
}

function ProjectRow({ p }: { p: ProjectView }) {
  return (
    <ListItem
      title={p.name}
      sub={p.updatedAt ? `更新于 ${formatRelative(p.updatedAt)}` : undefined}
      right={p.status ? <Badge variant="outline">{p.status}</Badge> : null}
    />
  );
}

function ProviderRow({ pv }: { pv: ProviderView }) {
  return (
    <ListItem
      title={pv.provider}
      sub={pv.defaultModel ?? undefined}
      right={
        <Badge variant={pv.isConnected ? "success" : "secondary"}>
          {pv.isConnected ? "已连接" : "未连接"}
        </Badge>
      }
    />
  );
}

function ConsoleChip({
  icon: Icon,
  label,
  value,
  loading,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  loading?: boolean;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.055] p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-white/45">{label}</p>
        <Icon className="size-4 text-cyan-200" />
      </div>
      <p className="mt-3 font-mono text-2xl font-semibold">{loading ? "—" : formatInt(value)}</p>
    </div>
  );
}
