"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { CircleAlert, CircleCheck, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  useCreateProject,
  useDeleteProject,
  useProfiles,
  useProjects,
  useUpdateProject,
} from "@/lib/queries";
import type { ProjectView } from "@/lib/types";
import { cn } from "@/lib/cn";
import { useFocusFlash } from "@/hooks/use-focus-flash";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function ProjectsPage() {
  return (
    <Suspense fallback={null}>
      <ProjectsPageBody />
    </Suspense>
  );
}

function ProjectsPageBody() {
  const list = useProjects();
  const del = useDeleteProject();
  const profiles = useProfiles();
  const searchParams = useSearchParams();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectView | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [flashId] = useFocusFlash(searchParams.get("focus"));

  // 该项目下绑定的个人 model 数量（FK cascade：删项目会连带删它们）
  const affectedModels = deleteTarget
    ? (profiles.data ?? []).filter((p) => p.projectId === deleteTarget.id).length
    : 0;

  if (list.isError) {
    return (
      <div>
        <PageHeader title="Projects" description="项目上下文（记忆纠错的第一性来源）" />
        <ErrorState message="Projects 加载失败，请确认后端服务可用" onRetry={() => void list.refetch()} />
      </div>
    );
  }

  const rows = list.data ?? [];

  async function onDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await del.mutateAsync(deleteTarget.id);
      toast.success(`已删除 Project「${deleteTarget.name}」`);
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
        title="Projects"
        description="为不同上下文隔离记忆与提示；可人工维护摘要 / 决策 / 已知问题"
        actions={
          <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
            <Plus className="h-4 w-4" />
            新建 Project
          </Button>
        }
      />

      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead>名称</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>摘要</TableHead>
              <TableHead>决策</TableHead>
              <TableHead>问题</TableHead>
              <TableHead>更新时间</TableHead>
              <TableHead className="w-20 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading && !list.data ? (
              <LoadingRows cols={7} />
            ) : rows.length === 0 ? (
              <EmptyRow colSpan={7}>
                <EmptyState
                  title="还没有 Project"
                  description="项目是记忆隔离的边界：可让不同项目拥有各自的记忆与上下文"
                  action={
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setEditing(null); setDialogOpen(true); }}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      创建第一个 Project
                    </Button>
                  }
                />
              </EmptyRow>
            ) : (
              rows.map((p) => (
                <TableRow key={p.id} className={cn(flashId === p.id && "bg-primary/10")}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell>
                    {p.status ? <Badge variant="outline">{p.status}</Badge> : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="max-w-64">
                    {p.summary ? (
                      <p className="truncate text-xs text-muted-foreground" title={p.summary}>
                        {p.summary}
                      </p>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <CircleCheck className="h-3.5 w-3.5 text-emerald-500" />
                      {p.decisions.length}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <CircleAlert className="h-3.5 w-3.5 text-amber-500" />
                      {p.knownIssues.length}
                    </span>
                  </TableCell>
                  <TableCell>
                    <DateCell value={p.updatedAt} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground"
                      onClick={() => { setEditing(p); setDialogOpen(true); }}
                      aria-label={`编辑 ${p.name}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleteTarget(p)}
                      aria-label={`删除 ${p.name}`}
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

      <ProjectFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={`删除 Project「${deleteTarget?.name}」？`}
        description={
          affectedModels > 0
            ? `删除后该项目相关记忆不可达，且其下绑定的 ${affectedModels} 个个人 model（及绑定它们的 Key）会一并删除。此操作不可恢复。`
            : "删除后该项目相关记忆将不可达。此操作不可恢复。"
        }
        loading={deleting}
        onConfirm={onDelete}
      />
    </div>
  );
}

/* ---------------- 表单 + 列表编辑器 ---------------- */

function ProjectFormDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: ProjectView | null;
}) {
  const create = useCreateProject();
  const update = useUpdateProject(editing?.id ?? "");
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [summary, setSummary] = useState("");
  const [architecture, setArchitecture] = useState("");
  const [status, setStatus] = useState("");
  const [decisions, setDecisions] = useState<string[]>([]);
  const [knownIssues, setKnownIssues] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setDescription(editing.description ?? "");
      setSummary(editing.summary ?? "");
      setArchitecture(editing.architecture ?? "");
      setStatus(editing.status ?? "");
      setDecisions(editing.decisions ?? []);
      setKnownIssues(editing.knownIssues ?? []);
    } else {
      setName("");
      setDescription("");
      setSummary("");
      setArchitecture("");
      setStatus("");
      setDecisions([]);
      setKnownIssues([]);
    }
  }, [open, editing]);

  async function onSave() {
    if (!name.trim()) {
      toast.error("名称为必填项");
      return;
    }
    setSaving(true);
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      summary: summary.trim() || null,
      architecture: architecture.trim() || null,
      status: status.trim() || null,
      decisions,
      knownIssues,
    };
    try {
      if (editing) {
        await update.mutateAsync(payload);
        toast.success("Project 已保存");
      } else {
        await create.mutateAsync(payload);
        toast.success(`Project「${name.trim()}」已创建`);
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
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? `编辑 Project「${editing.name}」` : "新建 Project"}</DialogTitle>
          <DialogDescription>
            决策与已知问题可作为记忆纠错的上下文来源，供客户端注入。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="名称 *" htmlFor="pj-name">
              <Input id="pj-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </Field>
            <Field label="状态" htmlFor="pj-status">
              <Input id="pj-status" placeholder="如 active / archived" value={status} onChange={(e) => setStatus(e.target.value)} />
            </Field>
          </div>

          <Field label="Description" htmlFor="pj-desc">
            <Textarea id="pj-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label="Summary" htmlFor="pj-summary" hint="一段话概括项目定位">
            <Textarea id="pj-summary" rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} />
          </Field>
          <Field label="Architecture" htmlFor="pj-arch">
            <Textarea id="pj-arch" rows={2} value={architecture} onChange={(e) => setArchitecture(e.target.value)} />
          </Field>

          <ListEditor
            label="决策（Decisions）"
            placeholder="记录一条已确认的决策…"
            items={decisions}
            onChange={setDecisions}
          />
          <ListEditor
            label="已知问题（Known Issues）"
            placeholder="记录一个已知问题…"
            items={knownIssues}
            onChange={setKnownIssues}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving ? <Spinner /> : null}
            {editing ? "保存修改" : "创建 Project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ListEditor({
  label,
  placeholder,
  items,
  onChange,
}: {
  label: string;
  placeholder: string;
  items: string[];
  onChange: (items: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    onChange([...items, v]);
    setDraft("");
  };

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="rounded-md border">
        <div className="flex items-center gap-1 border-b p-1.5">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder={placeholder}
            className="h-8 border-0 shadow-none focus-visible:ring-0"
          />
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={add}
            aria-label="添加条目"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
        {items.length > 0 ? (
          <ul className="max-h-40 divide-y overflow-y-auto">
            {items.map((it, i) => (
              <li key={i} className="group flex items-center gap-2 px-3 py-1.5 text-sm">
                <span className="text-xs tabular-nums text-muted-foreground">{i + 1}.</span>
                <span className="min-w-0 flex-1">{it}</span>
                <button
                  type="button"
                  className="rounded text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={() => onChange(items.filter((_, idx) => idx !== i))}
                  aria-label="删除条目"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-3 py-2 text-xs text-muted-foreground">暂无条目，输入后回车添加。</p>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
