import { formatDateTime } from "@/lib/format";

/** 统一日期显示；title 给完整绝对时间。 */
export function DateCell({ value, className }: { value?: string | null; className?: string }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const full = formatDateTime(value);
  return (
    <time
      dateTime={value}
      title={full}
      className={`whitespace-nowrap text-muted-foreground tabular-nums ${className ?? ""}`}
    >
      {full}
    </time>
  );
}
