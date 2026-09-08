"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CloudCog, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  useDeleteProvider,
  useProviders,
  useUpsertProvider,
} from "@/lib/queries";
import type { ProviderView } from "@/lib/types";
import { DEFAULT_PROVIDER } from "@/lib/provider-catalog";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Spinner } from "@/components/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

export default function ProvidersPage() {
  const list = useProviders();
  const del = useDeleteProvider();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProviderView | null>(null);
  const [deleting, setDeleting] = useState(false);

  if (list.isError) {
    return (
      <div>
        <PageHeader title="Providers" description="上游供应商配置" />
        <ErrorState message="Providers 加载失败，请确认后端服务可用" onRetry={() => void list.refetch()} />
      </div>
    );
  }

  const rows = list.data ?? [];
  // 首载守卫：数据未到前渲染骨架，避免把空态闪现成「尚未配置 Provider」
  const listLoading = list.isLoading && !list.data;

  async function onDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await del.mutateAsync(deleteTarget.id);
      toast.success(`已删除 ${deleteTarget.provider} 配置`);
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Providers"
        description="配置上游 API key（当前网关仅完整实现 deepseek）"
        actions={
          <Button
            onClick={() => {
              setCreating(true);
              setEditingId(null);
            }}
          >
            <Plus className="h-4 w-4" />
            配置 Provider
          </Button>
        }
      />

      {listLoading ? (
        <ProviderListSkeleton />
      ) : rows.length === 0 && !creating ? (
        <div className="rounded-xl border bg-card">
          <EmptyState
            icon={CloudCog}
            title="尚未配置 Provider"
            description="配置 DeepSeek API key 后，客户端 /v1 调用才会可用"
            action={
              <Button
                onClick={() => {
                  setCreating(true);
                  setEditingId(null);
                }}
              >
                <Plus className="h-3.5 w-3.5" />
                配置 DeepSeek key
              </Button>
            }
          />
        </div>
      ) : (
        <div className="grid max-w-3xl gap-4">
          {creating ? (
            <ProviderEditor
              editing={null}
              onDone={() => setCreating(false)}
            />
          ) : null}
          {rows.map((pv) =>
            editingId === pv.id ? (
              <ProviderEditor key={pv.id} editing={pv} onDone={() => setEditingId(null)} />
            ) : (
              <Card key={pv.id}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base font-mono">{pv.provider}</CardTitle>
                    <Badge variant={pv.isConnected ? "success" : "secondary"}>
                      {pv.isConnected ? "已连接" : "未连接"}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground"
                      onClick={() => setEditingId(pv.id)}
                      aria-label={`编辑 ${pv.provider}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleteTarget(pv)}
                      aria-label={`删除 ${pv.provider}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 pt-0 text-sm">
                  <Row k="Base URL" v={pv.baseUrl} mono />
                  <Row k="默认模型" v={pv.defaultModel} mono />
                  <Row
                    k="API Key"
                    v={pv.isConnected ? "已保存（出于安全不回显）" : "未配置"}
                    muted={pv.isConnected}
                  />
                </CardContent>
              </Card>
            ),
          )}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={`删除 ${deleteTarget?.provider} 配置？`}
        description="删除后该供应商的调用将失败（isConnected=false），需重新配置 key。"
        loading={deleting}
        onConfirm={onDelete}
      />
    </div>
  );
}

function Row({ k, v, mono = false, muted = false }: { k: string; v: string | null; mono?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{k}</span>
      {v ? (
        <span className={`text-right ${mono ? "font-mono text-xs" : ""} ${muted ? "text-muted-foreground" : ""}`}>
          {v}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
    </div>
  );
}

/** 加载骨架：仿 Provider 卡布局，避免空态闪现。 */
function ProviderListSkeleton() {
  return (
    <div className="grid max-w-3xl gap-4">
      {[0, 1].map((i) => (
        <Card key={i}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-5 w-14 rounded-full" />
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* ---------------- 行内编辑卡片 ---------------- */

function ProviderEditor({
  editing,
  onDone,
}: {
  editing: ProviderView | null;
  onDone: () => void;
}) {
  const upsert = useUpsertProvider();
  const [baseUrl, setBaseUrl] = useState(editing?.baseUrl ?? "");
  const [defaultModel, setDefaultModel] = useState(
    editing?.defaultModel ?? DEFAULT_PROVIDER.defaultModel,
  );
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  async function onSave() {
    setSaving(true);
    // 不填 apiKey → 保留旧 key（upsert 语义）；全新配置必须有 key 才 connected
    const payload: { provider: string; baseUrl: string | null; defaultModel: string | null; apiKey?: string } = {
      provider: editing?.provider ?? DEFAULT_PROVIDER.key,
      baseUrl: baseUrl.trim() || null,
      defaultModel: defaultModel.trim() || null,
    };
    if (apiKey.trim()) payload.apiKey = apiKey.trim();
    try {
      await upsert.mutateAsync(payload);
      toast.success(apiKey.trim() ? "已保存并验证连接" : "已保存（未填写新 key，保留原值）");
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  const title = editing
    ? `编辑 ${editing.provider}`
    : `配置 ${DEFAULT_PROVIDER.label}`;

  return (
    <Card className="border-primary/30">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground"
          onClick={onDone}
          aria-label="关闭编辑"
        >
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pv-base">Base URL</Label>
            <Input
              id="pv-base"
              className="font-mono text-xs"
              placeholder="https://api.deepseek.com（可空 = 官方默认）"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pv-model">默认模型</Label>
            <Input
              id="pv-model"
              className="font-mono text-xs"
              placeholder="deepseek-chat"
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pv-key">API Key</Label>
          <Input
            id="pv-key"
            type="password"
            className="font-mono"
            placeholder={editing?.isConnected ? "已保存 key（不显示）——留空保持不变" : "sk-…（必填才能连通）"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="new-password"
          />
          <p className="text-xs text-muted-foreground">
            key 加密存储、永不回显；未填写时保存会保留旧 key。
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={saving} onClick={onDone}>
            取消
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving ? <Spinner /> : null}
            保存
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
