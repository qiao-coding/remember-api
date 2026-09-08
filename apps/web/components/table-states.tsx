import { TableCell, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

/** 表格三态行：加载 = Skeleton 行；空 = EmptyRow(EmptyState colSpan)。错误态在页面级统一渲染。 */
export function LoadingRows({ cols, rows = 4 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: cols }).map((__, c) => (
            <TableCell key={c}>
              <Skeleton className="h-4 w-full max-w-28" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="h-full px-0 py-0">
        {children}
      </TableCell>
    </TableRow>
  );
}
