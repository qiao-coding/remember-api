"use client";

import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { LogOut, ShieldCheck, UserRound } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { createSupabaseBrowser } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { ErrorState } from "@/components/error-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";

interface Me {
  id: string;
  email: string;
  name?: string | null;
}

export default function SettingsPage() {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const me = useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => apiFetch<{ user: Me }>("/api/auth/me"),
  });

  async function signOut() {
    setSigningOut(true);
    try {
      await createSupabaseBrowser().auth.signOut();
      toast.success("已退出登录");
      router.replace("/login");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "退出失败");
      setSigningOut(false);
    }
  }

  const email = me.data?.user.email ?? "";
  const initials = (email || "?").slice(0, 2).toUpperCase();

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="Settings" description="账号信息与实例状态" />

      {me.isError ? (
        <ErrorState message="账号信息加载失败" onRetry={() => void me.refetch()} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">账号</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <Avatar className="h-12 w-12">
                <AvatarFallback className="text-sm">{initials}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1 space-y-0.5">
                {me.isLoading && !me.data ? (
                  <>
                    <Skeleton className="h-4 w-44" />
                    <Skeleton className="h-3 w-64" />
                  </>
                ) : (
                  <>
                    <p className="truncate text-sm font-medium">
                      {me.data?.user.name || "未设置名称"}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{email}</p>
                  </>
                )}
              </div>
            </div>

            <dl className="mt-5 grid gap-x-8 gap-y-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-2">
              <InfoRow label="邮箱" value={email} />
              <InfoRow
                label="用户 ID"
                value={me.data?.user.id ?? "…"}
                mono
              />
            </dl>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">实例</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p className="text-sm text-muted-foreground">
              本实例为<strong className="text-foreground"> 单用户部署</strong>：所有数据（Profile、记忆、用量）仅对当前账号可见且隔离于其他用户；同账号可在不同设备/工作台共享同一份记忆。
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-lg bg-muted/40 p-3">
            <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              客户端连接方式与示例值见 <span className="font-medium text-foreground">Docs</span> 页。
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardContent className="flex items-center justify-between gap-3 pt-6">
          <div>
            <p className="text-sm font-medium">退出登录</p>
            <p className="text-xs text-muted-foreground">将清除本机的登录会话，记忆与数据保留在云端。</p>
          </div>
          <Button variant="outline" onClick={() => setConfirmOpen(true)}>
            <LogOut className="h-4 w-4" />
            退出登录
          </Button>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="退出登录？"
        description="将清除本机会话，下次需重新输入邮箱与密码。"
        confirmText="确认退出"
        loading={signingOut}
        onConfirm={signOut}
      />
    </div>
  );
}

function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`truncate text-xs ${mono ? "font-mono" : ""}`}>{value || "—"}</dd>
    </div>
  );
}
