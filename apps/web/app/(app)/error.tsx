"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/** 路由级错误边界：错误隔离，文案指向后端不可用，提供重试。 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[route error]", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangle className="h-6 w-6 text-destructive" />
      </div>
      <h2 className="text-lg font-semibold">加载失败</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        请确认后端服务可用后重试。若为接口错误，错误信息：{error.message || "未知"}
      </p>
      <Button onClick={() => reset()} className="mt-2">
        重试
      </Button>
    </div>
  );
}
