"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export function CopyButton({
  value,
  label = "复制",
  className,
  variant = "outline",
}: {
  value: string;
  label?: string;
  className?: string;
  variant?: "outline" | "ghost" | "secondary" | "default";
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const copy = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      toast.success("已复制");
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("复制失败，请手动选择复制");
    }
  }, [value]);

  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      className={cn("h-7 gap-1.5 px-2 text-xs", className)}
      onClick={copy}
      aria-label={`${label}（${value}）`}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "已复制" : label}
    </Button>
  );
}
