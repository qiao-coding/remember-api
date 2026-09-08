"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus, Shapes, Trash2 } from "lucide-react";
import {
  useCreateSkill,
  useDeleteSkill,
  useProfiles,
  useSkills,
  useUpdateSkill,
} from "@/lib/queries";
import type { SkillView } from "@/lib/types";
import { countSkillUsage } from "@/lib/domain/skills";
import { formatInt } from "@/lib/format";
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

export default function SkillsPage() {
  const list = useSkills();
  const profiles = useProfiles();
  const del = useDeleteSkill();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SkillView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SkillView | null>(null);
  const [deleting, setDeleting] = useState(false);

  // skill id → 被多少个 Profile 引用
  const usedByCount = useMemo(
    () => countSkillUsage(profiles.data ?? []),
    [profiles.data],
  );

  if (list.isError) {
    return (
      <div>
        <PageHeader title="Skills" description="可复用的 prompt 片段" />
        <ErrorState message="Skills 加载失败，请确认后端服务可用" onRetry={() => void list.refetch()} />
      </div>
    );
  }

  const rows = list.data ?? [];
  // profiles 依赖未到位前不展示计数，避免误报「未使用」
  const profilesLoading = profiles.isLoading && !profiles.data;

  async function onDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await del.mutateAsync(deleteTarget.id);
      toast.success(`已删除 Skill「${deleteTarget.name}」`);
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
        title="Skills"
        description="跨 Profile 复用的 prompt 片段；token 数由后端估算"
        actions={
          <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
            <Plus className="h-4 w-4" />
            新建 Skill
          </Button>
        }
      />

      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead>名称</TableHead>
              <TableHead>说明</TableHead>
              <TableHead>Token 估算</TableHead>
              <TableHead>被 Profile 使用</TableHead>
              <TableHead>更新时间</TableHead>
              <TableHead className="w-20 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading && !list.data ? (
              <LoadingRows cols={6} />
            ) : rows.length === 0 ? (
              <EmptyRow colSpan={6}>
                <EmptyState
                  title="还没有 Skill"
                  description="Skill 是可注入到请求的 prompt 片段，可在 Profile 中按需勾选"
                  action={
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setEditing(null); setDialogOpen(true); }}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      创建第一个 Skill
                    </Button>
                  }
                />
              </EmptyRow>
            ) : (
              rows.map((s) => {
                const count = usedByCount.get(s.id) ?? 0;
                return (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="max-w-72">
                      {s.description ? (
                        <p className="truncate text-xs text-muted-foreground" title={s.description}>
                          {s.description}
                        </p>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">~{formatInt(s.tokenCount)} tokens</Badge>
                    </TableCell>
                    <TableCell>
                      {profilesLoading ? (
                        <span className="text-xs text-muted-foreground" aria-hidden>
                          …
                        </span>
                      ) : profiles.isError ? (
                        <span
                          className="text-xs text-muted-foreground"
                          title="Profile 列表不可用，无法统计使用情况"
                        >
                          —
                        </span>
                      ) : count > 0 ? (
                        <span className="text-xs text-muted-foreground">{count} 个 Profile</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">未使用</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <DateCell value={s.updatedAt} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground"
                        onClick={() => { setEditing(s); setDialogOpen(true); }}
                        aria-label={`编辑 ${s.name}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteTarget(s)}
                        aria-label={`删除 ${s.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <SkillFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={`删除 Skill「${deleteTarget?.name}」？`}
        description="删除后引用它的 Profile 将自动移除该片段。此操作不可恢复。"
        loading={deleting}
        onConfirm={onDelete}
      />
    </div>
  );
}

/* ---------------- 表单 ---------------- */

function SkillFormDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: SkillView | null;
}) {
  const create = useCreateSkill();
  const update = useUpdateSkill(editing?.id ?? "");
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setDescription(editing.description ?? "");
      setContent(editing.content);
    } else {
      setName("");
      setDescription("");
      setContent("");
    }
  }, [open, editing]);

  async function onSave() {
    if (!name.trim() || !content.trim()) {
      toast.error("名称与内容为必填项");
      return;
    }
    setSaving(true);
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      content,
    };
    try {
      if (editing) {
        await update.mutateAsync(payload);
        toast.success("Skill 已保存，token 估算已更新");
      } else {
        await create.mutateAsync(payload);
        toast.success(`Skill「${name.trim()}」已创建`);
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
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? `编辑 Skill「${editing.name}」` : "新建 Skill"}</DialogTitle>
          <DialogDescription>内容为 Markdown / 纯文本 prompt 片段，保存后由服务端估算 token。</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="flex items-center gap-3 rounded-md border bg-muted/40 px-3 py-2.5">
            <Shapes className="h-4 w-4 text-primary" />
            <p className="text-xs text-muted-foreground">
              保存后此片段会被注入到启用了它的 Profile 的每次请求中，token 会计入用量。
            </p>
          </div>

          <Field label="名称 *" htmlFor="sk-name">
            <Input id="sk-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="如 code-review-standards" />
          </Field>
          <Field label="说明" htmlFor="sk-desc">
            <Input id="sk-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="一句话说明这个片段的用途" />
          </Field>
          <Field label="内容 *" htmlFor="sk-content">
            <Textarea
              id="sk-content"
              rows={12}
              className="font-mono text-xs"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="# 规则&#10;- 每次变更遵循仓库既有代码风格…"
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving ? <Spinner /> : null}
            {editing ? "保存修改" : "创建 Skill"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
