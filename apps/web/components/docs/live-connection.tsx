"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { KeyRound } from "lucide-react";
import { useKeys, useProfiles } from "@/lib/queries";
import { firstDisabledKey, firstEnabledKey, maskKey } from "@/lib/domain/docs";
import { useDocsAuth } from "@/components/docs/auth-provider";
import { CopyButton } from "@/components/copy-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

/**
 * 登录用户的真实连接信息（Base URL / API Key 掩码 / Model）。
 * auth 门：未登录只渲染提示卡；真实值渲染（LiveFields）才挂 useKeys/useProfiles，
 * 从而未登录访问 /docs/quickstart 时对 /api 零请求。
 */
export function LiveConnection() {
  const { authed } = useDocsAuth();
  if (!authed) return <LoginPrompt />;
  return <LiveFields />;
}

function LoginPrompt() {
  return (
    <Card className="mt-3">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">你的连接信息</CardTitle>
      </CardHeader>
      <Separator />
      <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-4">
        <p className="text-sm text-muted-foreground">
          登录后这里会显示你实例的 Base URL / API Key / Model。
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href="/login?next=/docs/quickstart">登录控制台查看</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function LiveFields() {
  const profiles = useProfiles();
  const keys = useKeys();
  const [origin, setOrigin] = useState<string>("");

  useEffect(() => setOrigin(window.location.origin), []);

  const baseUrl = origin ? `${origin}/v1` : "";
  const model = profiles.data?.find(Boolean)?.name;
  const activeKey = firstEnabledKey(keys.data ?? []);
  const disabledKey = firstDisabledKey(keys.data ?? []);
  const keysLoading = keys.isLoading && !keys.data;

  if (profiles.isError || keys.isError) {
    return (
      <Card className="mt-3">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">你的连接信息</CardTitle>
        </CardHeader>
        <Separator />
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-4">
          <p className="text-sm text-muted-foreground">连接信息加载失败，请确认后端服务可用。</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void profiles.refetch();
              void keys.refetch();
            }}
          >
            重试
          </Button>
        </CardContent>
      </Card>
    );
  }

  const sample = activeKey ?? disabledKey;

  return (
    <Card className="mt-3">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">你的连接信息</CardTitle>
      </CardHeader>
      <Separator />
      <CardContent className="space-y-3 pt-4">
        <FieldRow label="Base URL" action={<CopyButton value={baseUrl} label="复制" />}>
          {baseUrl ? (
            <code className="min-w-0 flex-1 truncate font-mono text-xs">{baseUrl}</code>
          ) : (
            <span className="text-xs text-muted-foreground" aria-hidden>
              …
            </span>
          )}
        </FieldRow>

        <FieldRow
          label="API Key"
          action={
            sample ? (
              <Button asChild variant="outline" size="sm">
                <Link href="/keys">
                  <KeyRound className="size-3.5" />
                  管理 API Key
                </Link>
              </Button>
            ) : (
              <Button asChild variant="outline" size="sm">
                <Link href="/keys">
                  <KeyRound className="size-3.5" />
                  创建 API Key
                </Link>
              </Button>
            )
          }
        >
          {keysLoading ? (
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" aria-hidden>
              …
            </span>
          ) : sample ? (
            <>
              <code
                className={`min-w-0 flex-1 truncate font-mono text-xs ${
                  activeKey ? "" : "text-muted-foreground"
                }`}
              >
                {maskKey(sample)}
              </code>
              <Badge variant={activeKey ? "success" : "warning"} className="shrink-0">
                {activeKey ? "已启用" : "已禁用"}
              </Badge>
            </>
          ) : (
            <>
              <Badge variant="warning" className="shrink-0">
                待配置
              </Badge>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                尚未生成——去 API Keys 创建并复制明文
              </span>
            </>
          )}
        </FieldRow>

        <FieldRow
          label="Model"
          action={
            model ? (
              <CopyButton value={model} label="复制" />
            ) : (
              <Button asChild variant="outline" size="sm">
                <Link href="/profiles">创建 Profile</Link>
              </Button>
            )
          }
        >
          {model ? (
            <code className="min-w-0 flex-1 truncate font-mono text-xs">{model}</code>
          ) : (
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              尚无 Profile——先创建一个 model
            </span>
          )}
        </FieldRow>
      </CardContent>
    </Card>
  );
}

function FieldRow({
  label,
  children,
  action,
}: {
  label: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="grid items-center gap-1.5 sm:grid-cols-[6.5rem_1fr_auto] sm:gap-3">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex min-w-0 items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
        {children}
      </div>
      {action ? <div className="shrink-0">{action}</div> : <span className="hidden sm:block" />}
    </div>
  );
}
