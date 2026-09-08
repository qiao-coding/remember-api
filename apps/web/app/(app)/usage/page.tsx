"use client";

import { useMemo, useState } from "react";
import { useNameMaps, useUsageBreakdown, useUsageRequests, useUsageSummary } from "@/lib/queries";
import { formatCost, formatDateTime, formatInt, formatPercent } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { StatCard } from "@/components/stat-card";
import { EmptyRow, LoadingRows } from "@/components/table-states";
import { UsageBreakdownChart } from "@/components/chart/usage-breakdown-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const DAY_OPTIONS = [1, 7, 30] as const;
const LIMIT_OPTIONS = [10, 20, 50, 100] as const;

export default function UsagePage() {
  const [days, setDays] = useState(7);
  const [groupBy, setGroupBy] = useState<"profile" | "project">("profile");
  const [limit, setLimit] = useState(50);

  const summary = useUsageSummary(days);
  const breakdown = useUsageBreakdown(groupBy, days);
  const requests = useUsageRequests(limit);
  const { profileName, projectName } = useNameMaps();

  const nameOf = (key: string) =>
    groupBy === "profile" ? (profileName.get(key) ?? "") : (projectName.get(key) ?? "");

  const s = summary.data;
  const summaryLoading = summary.isLoading && !summary.data;

  const panelError = useMemo(() => {
    if (breakdown.isError || requests.isError) {
      return { retry: () => { void breakdown.refetch(); void requests.refetch(); } };
    }
    return null;
  }, [breakdown.isError, requests.isError]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Usage"
        description="token / 成本 / 记忆开销统计——判断记忆值不值"
        actions={
          <div className="flex items-center gap-1 rounded-lg border bg-card p-1">
            {DAY_OPTIONS.map((d) => (
              <Button
                key={d}
                variant="ghost"
                size="sm"
                className={cn("h-7", days === d && "bg-accent text-accent-foreground")}
                onClick={() => setDays(d)}
              >
                {d} 天
              </Button>
            ))}
          </div>
        }
      />

      {/* 统计卡 */}
      {summary.isError ? (
        <ErrorState message="用量汇总加载失败" onRetry={() => void summary.refetch()} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="请求数" value={s ? formatInt(s.requests) : "—"} sub={`近 ${days} 天`} loading={summaryLoading} />
          <StatCard
            label="Tokens"
            value={s ? formatInt(s.inputTokens + s.outputTokens) : "—"}
            sub={
              s
                ? `in ${formatInt(s.inputTokens)} · out ${formatInt(s.outputTokens)}${
                    s.cachedTokens ? ` · cached ${formatInt(s.cachedTokens)}` : ""
                  }`
                : undefined
            }
            loading={summaryLoading}
          />
          <StatCard
            label="估算成本"
            value={s ? formatCost(s.cost) : "—"}
            sub="按 token 计费估算"
            loading={summaryLoading}
            accent={!!s && s.cost > 0}
          />
          <StatCard
            label="记忆开销"
            value={s ? formatInt(s.memoryOverhead) : "—"}
            sub={s ? `缓存命中 ${formatPercent(s.cacheHit)}` : `近 ${days} 天`}
            loading={summaryLoading}
          />
        </div>
      )}

      {/* Breakdown 图 */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between space-y-0 pb-4">
          <CardTitle className="text-base">Token 分布</CardTitle>
          <div className="flex items-center gap-1 rounded-lg border bg-card p-0.5">
            {(["profile", "project"] as const).map((g) => (
              <Button
                key={g}
                variant="ghost"
                size="sm"
                className={cn("h-6 text-xs", groupBy === g && "bg-accent text-accent-foreground")}
                onClick={() => setGroupBy(g)}
              >
                {g === "profile" ? "按 Profile" : "按 Project"}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <UsageBreakdownChart
            data={breakdown.data ?? []}
            loading={breakdown.isLoading}
            names={nameOf}
          />
        </CardContent>
      </Card>

      {/* 明细表 */}
      {panelError ? (
        <ErrorState message="用量明细加载失败，请确认后端服务可用" onRetry={panelError.retry} />
      ) : (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base">请求明细</CardTitle>
            <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
              <SelectTrigger className="w-28" aria-label="每页条数">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LIMIT_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    最近 {n} 条
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent className="overflow-hidden rounded-b-xl">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead>时间</TableHead>
                  <TableHead>Profile</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead className="text-right">In</TableHead>
                  <TableHead className="text-right">Out</TableHead>
                  <TableHead className="text-right">Cached</TableHead>
                  <TableHead className="text-right">Memory</TableHead>
                  <TableHead className="text-right">Skill</TableHead>
                  <TableHead className="text-right">延迟</TableHead>
                  <TableHead className="text-right">成本</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.isLoading && !requests.data ? (
                  <LoadingRows cols={10} rows={6} />
                ) : (requests.data ?? []).length === 0 ? (
                  <EmptyRow colSpan={10}>
                    <EmptyState
                      title="暂无请求明细"
                      description="发起调用后，这里会记录每一条 token / 成本明细"
                    />
                  </EmptyRow>
                ) : (
                  (requests.data ?? []).map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                        {formatDateTime(r.createdAt)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {profileName.get(r.profileId) ?? r.profileId.slice(0, 8)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.provider}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatInt(r.inputTokens)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatInt(r.outputTokens)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatInt(r.cachedTokens)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {r.memoryTokens ? formatInt(r.memoryTokens) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {r.skillTokens ? formatInt(r.skillTokens) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {r.latencyMs} ms
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatCost(r.estimatedCost)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
