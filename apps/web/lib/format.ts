/**
 * 统一格式化（zh-CN 管理后台）。
 * 日期交给 date-fns（本地时区 `YYYY-MM-DD HH:mm`），数值交给 Intl.NumberFormat，
 * 不再手写 pad()/toFixed 正则拼串。相对时间文案是产品稿，保留字面档位。
 */
import { format } from "date-fns";

function toValidDate(iso?: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** ISO → `YYYY-MM-DD HH:mm`（本地时区） */
export function formatDateTime(iso?: string | null): string {
  const d = toValidDate(iso);
  return d ? format(d, "yyyy-MM-dd HH:mm") : "—";
}

/** ISO → `YYYY-MM-DD` */
export function formatDate(iso?: string | null): string {
  const d = toValidDate(iso);
  return d ? format(d, "yyyy-MM-dd") : "—";
}

/** 相对时间（如「5 分钟前」）；超过 7 天回退绝对日期 */
export function formatRelative(iso?: string | null): string {
  const d = toValidDate(iso);
  if (!d) return "—";
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} 天前`;
  return formatDateTime(iso);
}

// 成本（USD）：`$` + 最多 6 位小数去尾零（0 → `$0`）。估算值不分组，避免面板抖动。
const costFmt = new Intl.NumberFormat("zh-CN", {
  useGrouping: false,
  minimumFractionDigits: 0,
  maximumFractionDigits: 6,
});
export function formatCost(value: number | null | undefined): string {
  const v = value ?? 0;
  if (!isFinite(v)) return "$0";
  return `$${costFmt.format(v)}`;
}

/** 千分位整数 */
export function formatInt(value: number | null | undefined): string {
  const v = value ?? 0;
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(v);
}

/** 0–100 百分比一位小数（50.0%） */
const percentFmt = new Intl.NumberFormat("zh-CN", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
export function formatPercent(value: number | null | undefined): string {
  const v = value ?? 0;
  return percentFmt.format(v);
}
