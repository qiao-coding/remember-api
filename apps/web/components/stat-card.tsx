import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/cn";

export type StatCardProps = {
  label: string;
  value: ReactNode;
  sub?: string;
  loading?: boolean;
  icon?: LucideIcon;
  accent?: boolean;
};

/** 统计卡。加载态显示「—」（非 0），避免误导。 */
export function StatCard({ label, value, sub, loading = false, icon: Icon, accent }: StatCardProps) {
  return (
    <Card className={cn(accent && "border-primary/20 bg-primary/5")}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {Icon ? <Icon className="h-4 w-4 text-muted-foreground" /> : null}
      </CardHeader>
      <CardContent>
        {loading ? (
          <span className="text-2xl font-bold text-muted-foreground">—</span>
        ) : (
          <div className="text-2xl font-bold tabular-nums tracking-tight">{value}</div>
        )}
        {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
      </CardContent>
    </Card>
  );
}
