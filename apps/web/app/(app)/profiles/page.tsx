"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  useCreateProfile,
  useDeleteProfile,
  useProfiles,
  useProjects,
  useSkills,
  useUpdateProfile,
} from "@/lib/queries";
import type { ProfileView, ProjectView, SkillView } from "@/lib/types";
import { DEFAULT_PROVIDER } from "@/lib/provider-catalog";
import { profileBudget, toNullableNumber } from "@/lib/domain/profiles";
import { useFocusFlash } from "@/hooks/use-focus-flash";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DateCell } from "@/components/date-cell";
import { Spinner } from "@/components/spinner";
import { LoadingRows, EmptyRow } from "@/components/table-states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

export default function ProfilesPage() {
  return (
    <Suspense fallback={null}>
      <ProfilesPageBody />
    </Suspense>
  );
}

function ProfilesPageBody() {
  const list = useProfiles();
  const projects = useProjects();
  const skills = useSkills();
  const del = useDeleteProfile();
  const searchParams = useSearchParams();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProfileView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProfileView | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [flashId] = useFocusFlash(searchParams.get("focus"));

  if (list.isError) {
    return (
      <div>
        <PageHeader title="Profiles" description="管理客户端看到的 model" />
        <ErrorState message="Profiles 加载失败，请确认后端服务可用" onRetry={() => void list.refetch()} />
      </div>
    );
  }

  const rows = list.data ?? [];

  async function onDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await del.mutateAsync(deleteTarget.id);
      toast.success(`已删除 Profile「${deleteTarget.name}」`);
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  }

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (p: ProfileView) => {
    setEditing(p);
    setDialogOpen(true);
  };

  return (
    <div>
      <PageHeader
        title="Profiles"
        description="管理客户端看到的 model：每个 Profile 对应一个可调用的模型名"
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            新建 Profile
          </Button>
        }
      />

      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead>名称</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>模型</TableHead>
              <TableHead>项目</TableHead>
              <TableHead>记忆</TableHead>
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
                  title="还没有 Profile"
                  description="添加第一个 Profile 后，它就会作为 model 出现在客户端 /v1/models 中"
                  action={
                    <Button variant="outline" size="sm" onClick={openCreate}>
                      <Plus className="h-3.5 w-3.5" />
                      添加第一个
                    </Button>
                  }
                />
              </EmptyRow>
            ) : (
              rows.map((p) => (
                <TableRow
                  key={p.id}
                  className={cn(flashId === p.id && "bg-primary/10")}
                >
                  <TableCell className="font-mono text-xs font-medium">{p.name}</TableCell>
                  <TableCell className="text-muted-foreground">{p.provider}</TableCell>
                  <TableCell className="font-mono text-xs">{p.model}</TableCell>
                  <TableCell>
                    {p.projectName ? <Badge variant="secondary">{p.projectName}</Badge> : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    <span
                      className="inline-flex items-center gap-1.5"
                      title={p.memoryEnabled ? `记忆预算 ${p.memoryBudget} tokens` : "已关闭记忆"}
                    >
                      <Badge variant={p.memoryEnabled ? "success" : "secondary"}>
                        {p.memoryEnabled ? "开" : "关"}
                      </Badge>
                      {p.memoryEnabled ? (
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {p.memoryBudget}
                        </span>
                      ) : null}
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
                      onClick={() => openEdit(p)}
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

      <ProfileFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        projects={projects.data}
        skills={skills.data}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="删除 Profile？"
        description={`删除后「${deleteTarget?.name}」将不再出现在客户端 /v1/models 中，且无法恢复。`}
        loading={deleting}
        onConfirm={onDelete}
      />
    </div>
  );
}

/* ---------------- 新建/编辑 Dialog ---------------- */

function ProfileFormDialog({
  open,
  onOpenChange,
  editing,
  projects,
  skills,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: ProfileView | null;
  projects?: ProjectView[];
  skills?: SkillView[];
}) {
  const create = useCreateProfile();
  const update = useUpdateProfile(editing?.id ?? "");
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [project, setProject] = useState<string>("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [memoryBudget, setMemoryBudget] = useState("1500");
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [temperature, setTemperature] = useState("");
  const [maxTokens, setMaxTokens] = useState("");

  // 打开时按 editing 初始化 / 重置
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setModel(editing.model);
      setProject(editing.projectId);
      setSystemPrompt(editing.systemPrompt ?? "");
      setMemoryEnabled(editing.memoryEnabled);
      setMemoryBudget(String(editing.memoryBudget ?? 1500));
      setSkillIds(editing.skillIds ?? []);
      setTemperature(editing.temperature != null ? String(editing.temperature) : "");
      setMaxTokens(editing.maxTokens != null ? String(editing.maxTokens) : "");
    } else {
      setName("");
      setModel("");
      setProject("");
      setSystemPrompt("");
      setMemoryEnabled(true);
      setMemoryBudget("1500");
      setSkillIds([]);
      setTemperature("");
      setMaxTokens("");
    }
  }, [open, editing]);

  async function onSave() {
    if (!name.trim() || !model.trim()) {
      toast.error("名称与模型为必填项");
      return;
    }
    if (!project) {
      toast.error("请选择一个项目——每个个人 model 都必须属于一个项目");
      return;
    }
    setSaving(true);
    const payload = {
      name: name.trim(),
      provider: "deepseek" as const,
      model: model.trim(),
      projectId: project,
      systemPrompt: systemPrompt.trim() || null,
      memoryEnabled,
      memoryBudget: profileBudget(memoryBudget),
      skillIds,
      temperature: toNullableNumber(temperature),
      maxTokens: toNullableNumber(maxTokens),
    };
    try {
      if (editing) {
        await update.mutateAsync(payload);
        toast.success("Profile 已保存");
      } else {
        await create.mutateAsync(payload);
        toast.success(`Profile「${name.trim()}」已创建，客户端 /v1/models 现已可用`);
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
          <DialogTitle>{editing ? `编辑 Profile「${editing.name}」` : "新建 Profile"}</DialogTitle>
          <DialogDescription>
            名称将作为客户端填写的 model 值。Provider 当前仅支持 deepseek。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="名称 *" htmlFor="pf-name" hint="客户端用作 model 的值，需唯一">
              <Input
                id="pf-name"
                className="font-mono"
                placeholder="my-model"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </Field>
            <Field
              label="模型 *"
              htmlFor="pf-model"
              hint={`真实上游模型，如 ${DEFAULT_PROVIDER.defaultModel}`}
            >
              <Input
                id="pf-model"
                className="font-mono"
                placeholder={DEFAULT_PROVIDER.defaultModel}
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Provider">
            <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
              <span className="text-sm font-medium">deepseek</span>
              <span className="text-xs text-muted-foreground">（后端当前仅支持此值）</span>
            </div>
          </Field>

          <Field label="所属项目 *" htmlFor="pf-project">
            {projects && projects.length > 0 ? (
              <Select value={project} onValueChange={setProject}>
                <SelectTrigger id="pf-project">
                  <SelectValue placeholder="请选择项目" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((pr) => (
                    <SelectItem key={pr.id} value={pr.id}>
                      {pr.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm text-muted-foreground">
                还没有项目。个人 model 必须属于一个项目，
                <Link href="/projects" className="ml-1 text-cyan-500 underline">
                  先去创建 Project
                </Link>
              </p>
            )}
          </Field>

          <Field label="System Prompt" htmlFor="pf-prompt">
            <Textarea
              id="pf-prompt"
              rows={4}
              className="font-mono text-xs"
              placeholder="可选：自定义系统提示词"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
            />
          </Field>

          <div className="flex items-center justify-between gap-4 rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">启用记忆</p>
              <p className="text-xs text-muted-foreground">请求时注入该 Profile 相关记忆</p>
            </div>
            <Switch
              checked={memoryEnabled}
              onCheckedChange={setMemoryEnabled}
              aria-label="启用记忆"
            />
          </div>

          {memoryEnabled ? (
            <Field label="记忆预算（tokens）" htmlFor="pf-budget" hint="100–100000，默认 1500">
              <Input
                id="pf-budget"
                type="number"
                min={100}
                max={100000}
                className="max-w-40"
                value={memoryBudget}
                onChange={(e) => setMemoryBudget(e.target.value)}
              />
            </Field>
          ) : null}

          <Field label="Skills" hint="可选：注入到请求中的 prompt 片段">
            {skills && skills.length > 0 ? (
              <div className="grid max-h-44 grid-cols-1 gap-1 overflow-y-auto rounded-md border p-2 sm:grid-cols-2">
                {skills.map((s) => (
                  <label
                    key={s.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent"
                  >
                    <Checkbox
                      checked={skillIds.includes(s.id)}
                      onCheckedChange={(ck) =>
                        setSkillIds((prev) =>
                          ck
                            ? [...prev, s.id]
                            : prev.filter((id) => id !== s.id),
                        )
                      }
                    />
                    <span className="truncate">{s.name}</span>
                    <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                      {s.tokenCount}
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">还没有 Skill，可稍后在此绑定。</p>
            )}
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Temperature" htmlFor="pf-temp" hint="留空使用后端默认">
              <Input
                id="pf-temp"
                type="number"
                step={0.1}
                min={0}
                max={2}
                placeholder="默认"
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
              />
            </Field>
            <Field label="Max Tokens" htmlFor="pf-maxtok" hint="留空使用后端默认">
              <Input
                id="pf-maxtok"
                type="number"
                step={1}
                min={1}
                placeholder="默认"
                value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)}
              />
            </Field>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving ? <Spinner /> : null}
            {editing ? "保存修改" : "创建 Profile"}
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
