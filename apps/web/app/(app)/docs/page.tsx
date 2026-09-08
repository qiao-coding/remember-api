"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Copy, KeyRound, MousePointerClick, Plug, Terminal, Zap } from "lucide-react";
import { useKeys, useProfiles } from "@/lib/queries";
import type { KeyView } from "@/lib/types";
import { firstDisabledKey, firstEnabledKey, maskKey } from "@/lib/domain/docs";
import { PageHeader } from "@/components/page-header";
import { ErrorState } from "@/components/error-state";
import { CopyButton } from "@/components/copy-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export default function DocsPage() {
  const profiles = useProfiles();
  const keys = useKeys();
  const [origin, setOrigin] = useState<string>("");

  useEffect(() => setOrigin(window.location.origin), []);

  const baseUrl = origin ? `${origin}/v1` : "";
  const model = profiles.data?.find(Boolean)?.name;
  // 取最近一个启用的 key 展示掩码；没有启用的则取一个禁用的作「已禁用」示例
  const activeKey = firstEnabledKey(keys.data ?? []);
  const disabledKey = firstDisabledKey(keys.data ?? []);
  const keysLoading = keys.isLoading && !keys.data;

  // 后端不可用 → 明确报错 + 重试，绝不当成「尚无数据」
  if (profiles.isError || keys.isError) {
    return (
      <div className="max-w-3xl space-y-6">
        <PageHeader
          title="Docs"
          description="把本网关接入你的 AI 客户端（Claude Code / Codex / Cursor / dsh）"
        />
        <ErrorState
          message="Docs 连接信息加载失败，请确认后端服务可用"
          onRetry={() => {
            void profiles.refetch();
            void keys.refetch();
          }}
        />
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Docs"
        description="把本网关接入你的 AI 客户端（Claude Code / Codex / Cursor / dsh）"
      />

      {/* 三项连接信息 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">连接信息</CardTitle>
        </CardHeader>
        <Separator />
        <CardContent className="space-y-4 pt-5">
          <ConnectionRow
            label="Base URL"
            value={origin ? baseUrl : ""}
            placeholder="当前实例网关地址（同源 /v1 直通后端）"
          />
          <KeyConnectionRow keysLoading={keysLoading} activeKey={activeKey} disabledKey={disabledKey} />
          <ConnectionRow
            label="Model"
            value={model ?? ""}
            placeholder="尚无 Profile——先创建一个 model"
            linkHref="/profiles"
            linkText="创建 Profile"
          />
        </CardContent>
      </Card>

      {/* 四步接入 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">接入步骤</CardTitle>
        </CardHeader>
        <Separator />
        <CardContent className="space-y-0 pt-2">
          <Step
            n={1}
            icon={Plug}
            title="配置 Base URL"
            body={`将上面的 Base URL（${origin ? baseUrl : "…"}）填入客户端的 OpenAI 兼容 API 地址。`}
          />
          <Step
            n={2}
            icon={KeyRound}
            title="创建并粘贴 API Key"
            body="在 API Keys 页创建，明文只显示一次，请立即复制到客户端。"
            action={
              <Button asChild variant="outline" size="sm">
                <Link href="/keys">
                  <KeyRound className="h-3.5 w-3.5" />
                  去创建
                </Link>
              </Button>
            }
          />
          <Step
            n={3}
            icon={MousePointerClick}
            title="填入 Model"
            body={`把上面 Model（${model ? `当前为 ${model}` : "先在 Profiles 页创建一个 Profile"}）填为客户端模型名。`}
            action={
              model ? undefined : (
                <Button asChild variant="outline" size="sm">
                  <Link href="/profiles">
                    <Zap className="h-3.5 w-3.5" />
                    去创建 Profile
                  </Link>
                </Button>
              )
            }
          />
          <Step
            n={4}
            icon={Terminal}
            title="发起调用"
            body="同一份记忆、Skills 与 Preferences 会在所有接入的客户端间共享。"
          />
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        本页示例值均为真实值：Base URL 指向本控制台同源网关，Model 取第一个可用 Profile。
      </p>
    </div>
  );
}

/** API Key 行：接真实 key 状态，只显示掩码（明文在 keys 页一次性展示，此处不给复制）。 */
function KeyConnectionRow({
  keysLoading,
  activeKey,
  disabledKey,
}: {
  keysLoading: boolean;
  activeKey: KeyView | null;
  disabledKey: KeyView | null;
}) {
  const sample = activeKey ?? disabledKey;
  return (
    <div className="grid gap-1.5 sm:grid-cols-[7rem_1fr_auto] sm:items-center">
      <span className="text-sm font-medium">API Key</span>
      <div className="flex min-w-0 items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
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
            <Badge
              variant={activeKey ? "success" : "warning"}
              className="shrink-0"
            >
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
      </div>
      <Button asChild variant="outline" size="sm">
        <Link href="/keys">
          <KeyRound className="h-3.5 w-3.5" />
          {sample ? "管理 API Key" : "创建 API Key"}
        </Link>
      </Button>
    </div>
  );
}

function ConnectionRow({
  label,
  value,
  placeholder,
  linkHref,
  linkText,
}: {
  label: string;
  value: string;
  placeholder: string;
  linkHref?: string;
  linkText?: string;
}) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[7rem_1fr_auto] sm:items-center">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex min-w-0 items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
        {value ? (
          <code className="min-w-0 flex-1 truncate font-mono text-xs">{value}</code>
        ) : (
          <>
            <Badge variant="warning" className="shrink-0">
              待配置
            </Badge>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{placeholder}</span>
          </>
        )}
      </div>
      {value ? (
        <CopyButton value={value} label="复制" />
      ) : linkHref ? (
        <Button asChild variant="outline" size="sm">
          <Link href={linkHref}>
            <Copy className="h-3.5 w-3.5" />
            {linkText}
          </Link>
        </Button>
      ) : (
        <span />
      )}
    </div>
  );
}

function Step({
  n,
  icon: Icon,
  title,
  body,
  action,
}: {
  n: number;
  icon: typeof Plug;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex gap-3 py-4">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <Icon className="h-3.5 w-3.5 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          <span className="mr-1.5 text-muted-foreground">{n}.</span>
          {title}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{body}</p>
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
    </div>
  );
}
