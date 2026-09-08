"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Pencil, Pin, Plus, Search, Trash2, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import {
  QK,
  useCreateMemory,
  useDeleteMemory,
  useMemories,
  useMemoryOne,
  useProjects,
  useUpdateMemory,
} from "@/lib/queries";
import { MEMORY_TYPE_LABEL, type MemoryItem, type MemoryType } from "@/lib/types";
import {
  TYPE_VARIANT,
  focusMemoryFallbackNeeded,
  memoryNeedsExpand,
  memoryToggle,
} from "@/lib/domain/memories";
import { useFocusFlash } from "@/hooks/use-focus-flash";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DateCell } from "@/components/date-cell";
import { Spinner } from "@/components/spinner";
import { EmptyRow, LoadingRows } from "@/components/table-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const GLOBAL = "__global__";
const NONE = "__none__";
const LIMIT_OPTIONS = [20, 50, 100] as const;

export default function MemoriesPage() {
  return (
    <Suspense fallback={null}>
      <MemoriesPageBody />
    </Suspense>
  );
}

function MemoriesPageBody() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const projects = useProjects();

  // 全局搜索跳转定位：?focus=<id>
  const focus = searchParams.get("focus");

  // q 初值来自历史 ?q=…（现全局搜索走 focus，此处保留兼容）
  const initialQ = searchParams.get("q") ?? "";
  const [q, setQ] = useState(initialQ);
  const [debouncedQ, setDebouncedQ] = useState(initialQ);
  const [type, setType] = useState<MemoryType | "">("");
  const [projectId, setProjectId] = useState<string>(""); // ""=全部 ""==GLOBAL=仅全局 否则项目id
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [limit, setLimit] = useState<number>(50);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  const [flashId, clearFlash] = useFocusFlash(focus, 2200);

  const hasQuery = debouncedQ.length > 0;
  const list = useMemories({
    q: hasQuery ? debouncedQ : undefined,
    projectId: projectId || undefined,
    type: type || undefined,
    pinnedOnly: pinnedOnly || undefined,
    limit,
  });

  const del = useDeleteMemory();

  const pinMut = useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) =>
      apiFetch<MemoryItem>(`/api/memories/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ pinned }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: QK.memories({}) }),
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MemoryItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MemoryItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  // 行内内容展开：同一时间只展开一条
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const projectName = useMemo(() => {
    const m = new Map<string, string>();
    projects.data?.forEach((p) => m.set(p.id, p.name));
    return m;
  }, [projects.data]);

  const rows = list.data ?? [];

  // focus 定位：目标在当前筛选结果中 → 滚动高亮；否则拉单条置顶展示
  const listSettled = !(list.isLoading && !list.data);
  const focusedInRows = focus ? rows.some((r) => r.id === focus) : false;
  const needsFallback = focusMemoryFallbackNeeded({
    focus,
    rowIds: rows.map((r) => r.id),
    listSettled,
    listError: list.isError,
  });
  const focused = useMemoryOne(needsFallback ? focus : null);
  const focusedMemory = focused.data ?? null;

  useEffect(() => {
    if (!focus || !focusedInRows) return;
    const t = window.setTimeout(() => {
      document
        .querySelector(`[data-mem-id="${CSS.escape(focus)}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 60);
    return () => window.clearTimeout(t);
  }, [focus, focusedInRows]);

  const clearFocus = () => {
    clearFlash();
    router.replace("/memories");
  };

  async function togglePinned(row: MemoryItem, pinned: boolean) {
    try {
      await pinMut.mutateAsync({ id: row.id, pinned });
      toast.success(pinned ? "已固定" : "已取消固定");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "更新失败");
    }
  }

  async function onDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await del.mutateAsync(deleteTarget.id);
      toast.success("已删除该记忆");
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  }

  if (list.isError) {
    return (
      <div>
        <PageHeader title="Memories" description="记忆可见、可改、可控" />
        <ErrorState message="Memories 加载失败，请确认后端服务可用" onRetry={() => void list.refetch()} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Memories"
        description="查看并修正 AI 记住的内容；搜索会返回相关度排序"
        actions={
          <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
            <Plus className="h-4 w-4" />
            新建记忆
          </Button>
        }
      />

      {/* 全局搜索 focus：目标不在当前筛选结果时，拉单条置顶展示，可清除 */}
      {focus && listSettled && !focusedInRows && !list.isError ? (
        <div className="mb-4 overflow-hidden rounded-xl border border-primary/30 bg-primary/5">
          <div className="flex items-center justify-between gap-2 px-4 py-2">
            <p className="text-xs font-medium text-primary">
              已定位到一条记忆（不在当前筛选结果中）
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-muted-foreground"
              onClick={clearFocus}
            >
              <X className="h-3.5 w-3.5" />
              清除聚焦
            </Button>
          </div>
          <div className="space-y-2 border-t px-4 py-3">
            {focused.isError ? (
              <p className="text-sm text-muted-foreground">
                该记忆不存在或不可访问，可能已被删除。
              </p>
            ) : !focusedMemory ? (
              <p className="text-sm text-muted-foreground">加载中…</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={TYPE_VARIANT[focusedMemory.type]}>
                    {MEMORY_TYPE_LABEL[focusedMemory.type] ?? focusedMemory.type}
                  </Badge>
                  {focusedMemory.projectId ? (
                    <Badge variant="secondary">
                      {projectName.get(focusedMemory.projectId) ??
                        focusedMemory.projectId.slice(0, 8)}
                    </Badge>
                  ) : (
                    <Badge variant="outline">全局</Badge>
                  )}
                  <span className="text-xs tabular-nums text-muted-foreground">
                    重要度 {focusedMemory.importance.toFixed(2)}
                  </span>
                  <DateCell value={focusedMemory.createdAt} />
                </div>
                <p className="whitespace-pre-wrap text-sm">{focusedMemory.content}</p>
              </>
            )}
          </div>
        </div>
      ) : null}

      {/* 过滤 / 搜索区 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="搜索记忆内容…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <Select value={type} onValueChange={(v) => setType(v as MemoryType | "")}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="类型：全部" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">全部类型</SelectItem>
            {(Object.entries(MEMORY_TYPE_LABEL) as [MemoryType, string][]).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="归属：全部" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">全部（全局 + 项目）</SelectItem>
            <SelectItem value={GLOBAL}>仅全局</SelectItem>
            {projects.data?.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <label className="flex h-9 cursor-pointer select-none items-center gap-2 rounded-md border px-3 text-sm">
          <Switch checked={pinnedOnly} onCheckedChange={setPinnedOnly} aria-label="仅看已固定" />
          仅固定
        </label>

        <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
          <SelectTrigger className="w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LIMIT_OPTIONS.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n} 条
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="min-w-64">内容</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>归属</TableHead>
              <TableHead className="w-28">重要度</TableHead>
              <TableHead className="w-28">固定</TableHead>
              <TableHead>来源</TableHead>
              <TableHead className="w-36">时间</TableHead>
              {hasQuery ? <TableHead className="w-20 text-right">相关度</TableHead> : null}
              <TableHead className="w-20 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading && !list.data ? (
              <LoadingRows cols={hasQuery ? 9 : 8} />
            ) : rows.length === 0 ? (
              <EmptyRow colSpan={hasQuery ? 9 : 8}>
                <EmptyState
                  title={hasQuery ? "没有匹配的记忆" : "还没有记忆"}
                  description={
                    hasQuery
                      ? "换个关键词试试，或放宽类型 / 归属过滤"
                      : "AI 会在对话中自动沉淀记忆；也可手动添加一条"
                  }
                  action={
                    !hasQuery ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { setEditing(null); setDialogOpen(true); }}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        手动添加
                      </Button>
                    ) : undefined
                  }
                />
              </EmptyRow>
            ) : (
              rows.map((m) => (
                <TableRow
                  key={m.id}
                  data-mem-id={m.id}
                  className={cn(flashId === m.id && "bg-primary/10")}
                >
                  <TableCell className="max-w-[22rem] align-top">
                    <div>
                      <p
                        className={cn(
                          "break-words whitespace-pre-wrap text-sm",
                          expandedId !== m.id && "line-clamp-2",
                        )}
                      >
                        {m.content}
                      </p>
                      {memoryNeedsExpand(m.content) ? (
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedId((cur) => memoryToggle(cur, m.id))
                          }
                          className="mt-1 inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline"
                          aria-expanded={expandedId === m.id}
                        >
                          {expandedId === m.id ? (
                            <>
                              收起 <ChevronUp className="h-3 w-3" />
                            </>
                          ) : (
                            <>
                              展开 <ChevronDown className="h-3 w-3" />
                            </>
                          )}
                        </button>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={TYPE_VARIANT[m.type]}>
                      {MEMORY_TYPE_LABEL[m.type] ?? m.type}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {m.projectId ? (
                      <Badge variant="secondary">{projectName.get(m.projectId) ?? m.projectId.slice(0, 8)}</Badge>
                    ) : (
                      <Badge variant="outline">全局</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2" title={`重要度 ${m.importance.toFixed(2)}`}>
                      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${Math.max(4, Math.round(m.importance * 100))}%` }}
                        />
                      </div>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {m.importance.toFixed(2)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Switch
                        checked={m.pinned}
                        onCheckedChange={(ck) => void togglePinned(m, ck)}
                        disabled={pinMut.isPending}
                        aria-label="固定"
                      />
                      <Pin className={cn("h-3 w-3", m.pinned ? "text-primary" : "opacity-40")} />
                      {m.pinned ? "固定" : "取消固定"}
                    </label>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{m.source}</TableCell>
                  <TableCell>
                    <DateCell value={m.createdAt} />
                  </TableCell>
                  {hasQuery ? (
                    <TableCell className="text-right text-xs tabular-nums text-primary">
                      {m.relevance != null ? formatPercent(m.relevance) : "—"}
                    </TableCell>
                  ) : null}
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground"
                      onClick={() => { setEditing(m); setDialogOpen(true); }}
                      aria-label="编辑记忆"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleteTarget(m)}
                      aria-label="删除记忆"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <MemoryFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        projects={projects.data}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="删除这条记忆？"
        description="删除后 AI 将不再引用这条记忆。此操作不可恢复。"
        loading={deleting}
        onConfirm={onDelete}
      />
    </div>
  );
}

/* ---------------- 新建 / 编辑 Dialog ---------------- */

function MemoryFormDialog({
  open,
  onOpenChange,
  editing,
  projects,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: MemoryItem | null;
  projects?: { id: string; name: string }[];
}) {
  const create = useCreateMemory();
  const update = useUpdateMemory(editing?.id ?? "");
  const [saving, setSaving] = useState(false);

  const [content, setContent] = useState("");
  const [type, setType] = useState<MemoryType>("status");
  const [importance, setImportance] = useState(0.5);
  const [pinned, setPinned] = useState(false);
  const [projectId, setProjectId] = useState<string>(NONE);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setContent(editing.content);
      setType(editing.type);
      setImportance(editing.importance ?? 0.5);
      setPinned(editing.pinned ?? false);
      setProjectId(editing.projectId ?? NONE);
    } else {
      setContent("");
      setType("status");
      setImportance(0.5);
      setPinned(false);
      setProjectId(NONE);
    }
  }, [open, editing]);

  async function onSave() {
    if (!content.trim()) {
      toast.error("内容为必填项");
      return;
    }
    setSaving(true);
    const payload = {
      content: content.trim(),
      type,
      importance,
      pinned,
      projectId: projectId === NONE ? null : projectId,
    };
    try {
      if (editing) {
        await update.mutateAsync(payload);
        toast.success("记忆已更新");
      } else {
        await create.mutateAsync(payload);
        toast.success("记忆已创建");
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "编辑记忆" : "新建记忆"}</DialogTitle>
          <DialogDescription>记忆类型与归属决定它会被哪些请求注入。</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <Field label="内容 *" htmlFor="mem-content">
            <Textarea
              id="mem-content"
              rows={4}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              autoFocus
              placeholder="例如：该用户偏好 TypeScript 与简洁实现"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="类型" htmlFor="mem-type">
              <Select value={type} onValueChange={(v) => setType(v as MemoryType)}>
                <SelectTrigger id="mem-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(MEMORY_TYPE_LABEL) as [MemoryType, string][]).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="归属" htmlFor="mem-proj">
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger id="mem-proj">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>全局</SelectItem>
                  {projects?.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field label={`重要度 ${importance.toFixed(2)}`} htmlFor="mem-imp">
            <Slider
              id="mem-imp"
              min={0}
              max={1}
              step={0.01}
              value={[importance]}
              onValueChange={([v]) => setImportance(v ?? 0.5)}
              aria-label="重要度"
            />
          </Field>

          <div className="flex items-center justify-between gap-4 rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">固定这条记忆</p>
              <p className="text-xs text-muted-foreground">固定后始终参与注入，不易被归档淘汰</p>
            </div>
            <Switch checked={pinned} onCheckedChange={setPinned} aria-label="固定" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving ? <Spinner /> : null}
            {editing ? "保存修改" : "创建记忆"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
