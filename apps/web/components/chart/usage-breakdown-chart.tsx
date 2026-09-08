"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { UsageBreakdown } from "@/lib/types";
import { formatCost, formatInt } from "@/lib/format";
import { useChartColors } from "@/lib/chart";
import { EmptyState } from "@/components/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartNoAxesColumn } from "lucide-react";

export function UsageBreakdownChart({
  data,
  loading,
  names,
}: {
  data: UsageBreakdown[];
  loading: boolean;
  names: (key: string) => string;
}) {
  const colors = useChartColors();
  const rows = useMemo(
    () =>
      data.map((d, i) => ({
        name: names(d.key) || d.key.slice(0, 8),
        tokens: d.tokens,
        cost: d.cost,
        fill: colors[i % colors.length],
      })),
    [data, names, colors],
  );

  if (loading && data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Skeleton className="h-full w-full rounded-lg" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-dashed bg-muted/20">
        <EmptyState
          compact
          icon={ChartNoAxesColumn}
          title="该时段暂无用量数据"
          description="发起一次带记忆的 /v1 调用后，这里会按维度展示 token 分布"
        />
      </div>
    );
  }

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="rgba(140,140,140,0.15)" />
          <XAxis
            dataKey="name"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12, fill: colors[1] }}
            interval={0}
            angle={rows.length > 6 ? -18 : 0}
            textAnchor={rows.length > 6 ? "end" : "middle"}
            height={rows.length > 6 ? 48 : 30}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: colors[1] }}
            tickFormatter={(v: number) => formatInt(v)}
            width={44}
          />
          <Tooltip
            cursor={{ fill: "rgba(140,140,140,0.08)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0]?.payload as { name: string; tokens: number; cost: number };
              if (!p) return null;
              return (
                <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
                  <p className="font-medium">{p.name}</p>
                  <p className="mt-0.5 tabular-nums text-muted-foreground">
                    {formatInt(p.tokens)} tokens · {formatCost(p.cost)}
                  </p>
                </div>
              );
            }}
          />
          <Bar dataKey="tokens" radius={[4, 4, 0, 0]} maxBarSize={40}>
            {rows.map((r) => (
              <Cell key={r.name} fill={r.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
