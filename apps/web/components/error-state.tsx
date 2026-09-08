import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/** 数据加载错误态（非空态）：明确提示后端不可用 + 重试，绝不当空数据。 */
export function ErrorState({
  message = "加载失败，请确认后端服务可用",
  onRetry,
  className,
  compact = false,
}: {
  message?: string;
  onRetry?: () => void;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 text-center",
        compact ? "py-6" : "py-12",
        className,
      )}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangle className="h-5 w-5 text-destructive" />
      </div>
      <p className="text-sm font-medium text-destructive">{message}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" className="mt-1" onClick={onRetry}>
          <RotateCw className="h-3.5 w-3.5" />
          重试
        </Button>
      ) : null}
    </div>
  );
}
