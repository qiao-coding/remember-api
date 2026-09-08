import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
      <Compass className="h-10 w-10 text-muted-foreground" />
      <h2 className="text-lg font-semibold">页面不存在</h2>
      <p className="text-sm text-muted-foreground">你访问的页面不存在或已被移动。</p>
      <Button asChild className="mt-2">
        <Link href="/dashboard">返回 Dashboard</Link>
      </Button>
    </div>
  );
}
