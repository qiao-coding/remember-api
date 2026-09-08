"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Ban, CircleCheck, Dices, KeyRound, Plus, RefreshCw, Trash2 } from "lucide-react";
import {
  useCreateKey,
  useDeleteKey,
  useKeys,
  useProfiles,
  useRebindKey,
  useSetKeyDisabled,
} from "@/lib/queries";
import type { KeyCreated, KeyView } from "@/lib/types";
import { formatDateTime, formatRelative } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DateCell } from "@/components/date-cell";
import { CopyButton } from "@/components/copy-button";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function KeysPage() {
  const list = useKeys();
  const setDisabled = useSetKeyDisabled();
  const del = useDeleteKey();
  const rebind = useRebindKey();
  const profiles = useProfiles();
  const profileName = (id: string) =>
    profiles.data?.find((p) => p.id === id)?.name ?? id;

  const [createOpen, setCreateOpen] = useState(false);
  const [disableTarget, setDisableTarget] = useState<KeyView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<KeyView | null>(null);
  const [rebindTarget, setRebindTarget] = useState<KeyView | null>(null);
  const [busy, setBusy] = useState(false);

  if (list.isError) {
    return (
      <div>
        <PageHeader title="API Keys" description="供客户端调用 /v1 的密钥" />
        <ErrorState message="API Keys 加载失败，请确认后端服务可用" onRetry={() => void list.refetch()} />
      </div>
    );
  }

  const rows = list.data ?? [];

  async function toggleDisabled(k: KeyView, disabled: boolean) {
    try {
      await setDisabled.mutateAsync({ id: k.id, disabled });
      toast.success(disabled ? `已禁用「${k.name}」` : `已启用「${k.name}」`);
      setDisableTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
    }
  }

  async function onDelete() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await del.mutateAsync(deleteTarget.id);
      toast.success(`已删除 Key「${deleteTarget.name}」`);
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="API Keys"
        description="调用密钥。每个 key 都绑定一个个人 model（子 agent），只能调用它那一个"
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            新建 Key
          </Button>
        }
      />

      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead>名称</TableHead>
              <TableHead>绑定</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>最近使用</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead className="w-28 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading && !list.data ? (
              <LoadingRows cols={7} />
            ) : rows.length === 0 ? (
              <EmptyRow colSpan={7}>
                <EmptyState
                  title="还没有 API Key"
                  description="创建后明文只显示一次，请立即复制到客户端配置"
                  action={
                    <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
                      <Plus className="h-3.5 w-3.5" />
                      创建第一个 Key
                    </Button>
                  }
                />
              </EmptyRow>
            ) : (
              rows.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="font-medium">{k.name}</TableCell>
                  <TableCell>
                    <Badge title="该 key 只能调用这个子 agent">
                      {profileName(k.profileId)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <code className="font-mono text-xs">
                      {k.prefix}…{k.last4}
                    </code>
                  </TableCell>
                  <TableCell>
                    <Badge variant={k.disabled ? "secondary" : "success"}>
                      {k.disabled ? "已禁用" : "启用中"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {k.lastUsedAt ? (
                      <span className="text-xs text-muted-foreground" title={formatDateTime(k.lastUsedAt)}>
                        {formatRelative(k.lastUsedAt)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <DateCell value={k.createdAt} />
                  </TableCell>
                  <TableCell className="text-right">
                    {k.disabled ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => void toggleDisabled(k, false)}
                        disabled={setDisabled.isPending}
                      >
                        <CircleCheck className="h-3.5 w-3.5" />
                        启用
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-muted-foreground hover:text-amber-600"
                        onClick={() => setDisableTarget(k)}
                        aria-label={`禁用 ${k.name}`}
                      >
                        <Ban className="h-3.5 w-3.5" />
                        禁用
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ml-1 h-7 w-7 text-muted-foreground hover:text-primary"
                      onClick={() => setRebindTarget(k)}
                      aria-label={`换绑 ${k.name}`}
                      title="换绑到另一个个人 model"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ml-1 h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleteTarget(k)}
                      aria-label={`删除 ${k.name}`}
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

      <CreateKeyDialog open={createOpen} onOpenChange={setCreateOpen} />

      <RebindDialog
        open={rebindTarget !== null}
        onOpenChange={(o) => !o && setRebindTarget(null)}
        target={rebindTarget}
      />

      <ConfirmDialog
        open={disableTarget !== null}
        onOpenChange={(o) => !o && setDisableTarget(null)}
        title={`禁用 Key「${disableTarget?.name}」？`}
        description="禁用后使用该 Key 的客户端 /v1 调用会立即失败（401）。可随时重新启用。"
        confirmText="确认禁用"
        loading={setDisabled.isPending}
        onConfirm={() => disableTarget && void toggleDisabled(disableTarget, true)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={`删除 Key「${deleteTarget?.name}」？`}
        description="删除后该 Key 立即失效，且不可恢复。使用它的客户端需要换用新的 Key。"
        loading={busy}
        onConfirm={onDelete}
      />
    </div>
  );
}

/* ---------------- 新建（一次性明文） ---------------- */

/** 像"定制密码"一样给用户一个可一键填好的候选 secret（仍可再改）。 */
function quickSecret(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return "sk-" + hex.slice(0, 24);
}

function CreateKeyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const create = useCreateKey();
  const profiles = useProfiles();
  const [name, setName] = useState("");
  const [secret, setSecret] = useState("");
  const [profileId, setProfileId] = useState<string>("");
  const [created, setCreated] = useState<KeyCreated | null>(null);

  const findName = (id: string) =>
    profiles.data?.find((p) => p.id === id)?.name ?? id;

  useEffect(() => {
    if (!open) {
      setName("");
      setSecret("");
      setProfileId("");
      setCreated(null);
    }
  }, [open]);

  async function onCreate() {
    if (!name.trim()) {
      toast.error("请输入 Key 名称");
      return;
    }
    if (!profileId) {
      const first = profiles.data?.[0];
      if (!first) {
        toast.error("还没有个人 model，请先创建 Profile");
        return;
      }
      setProfileId(first.id);
    }
    const trimmedSecret = secret.trim();
    if (trimmedSecret && trimmedSecret.length < 8) {
      toast.error("自定义 secret 至少 8 个字符（或留空让系统自动生成）");
      return;
    }
    try {
      const bindId = profileId || profiles.data?.[0]?.id;
      if (!bindId) {
        toast.error("还没有个人 model，请先创建 Profile");
        return;
      }
      const payload: { name: string; profileId: string; secret?: string } = {
        name: name.trim(),
        profileId: bindId,
      };
      if (trimmedSecret) payload.secret = trimmedSecret; // 留空 → 服务端生成
      const k = await create.mutateAsync(payload);
      setCreated(k);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "创建失败");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !create.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{created ? "Key 创建成功" : "新建 API Key"}</DialogTitle>
          <DialogDescription>
            {created
              ? "请立即复制保存——数据库仅存哈希，关闭后无法再次查看明文。"
              : "每个 key 强制绑定一个个人 model（子 agent），只能调用它那一个。"}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="space-y-3">
            <p className="rounded-md bg-primary/10 px-3 py-2 text-xs text-primary">
              已绑定个人 model「{findName(created.profileId)}」，只能调用它一个。
            </p>
            <div className="flex items-center gap-1.5 rounded-md border bg-muted/40 p-2.5">
              <KeyRound className="h-4 w-4 shrink-0 text-primary" />
              <code className="min-w-0 flex-1 break-all font-mono text-xs">{created.key}</code>
            </div>
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              {secret.trim() && created.key === secret.trim()
                ? "这是你自定义的明文，数据库仅存哈希。请妥善保存，关闭后无法再次查看。"
                : "明文只显示这一次。请立即复制，关闭本窗口后将无法再次查看。"}
            </p>
            <div className="flex justify-end gap-2">
              <CopyButton value={created.key} label="复制 Key" />
              <Button onClick={() => onOpenChange(false)}>完成</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <Field label="名称" htmlFor="key-name">
              <Input
                id="key-name"
                placeholder="如 claude-code / cursor"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void onCreate()}
                autoFocus
              />
            </Field>

            <Field label="绑定个人 model（子 agent）*" htmlFor="key-profile">
              {profiles.data && profiles.data.length > 0 ? (
                <Select
                  value={profileId || profiles.data[0]?.id || ""}
                  onValueChange={(v) => setProfileId(v)}
                >
                  <SelectTrigger id="key-profile" className="w-full">
                    <SelectValue placeholder="选择要绑定的个人 model" />
                  </SelectTrigger>
                  <SelectContent>
                    {profiles.data.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm text-muted-foreground">
                  还没有个人 model，
                  <Link href="/profiles" className="ml-1 text-cyan-500 underline">
                    先去创建 Profile
                  </Link>
                </p>
              )}
              <p className="text-xs text-muted-foreground">一个 key 只能调用这一个子 agent，与其他 key 彼此隔离</p>
            </Field>

            <div className="space-y-1.5">
              <Label htmlFor="key-secret">Secret（自定义为主）</Label>
              <div className="flex gap-2">
                <Input
                  id="key-secret"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder="自定义，如 sk-123456"
                  className="flex-1 font-mono"
                  onKeyDown={(e) => e.key === "Enter" && void onCreate()}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => setSecret(quickSecret())}
                  title="随机生成一个 secret"
                >
                  <Dices className="h-4 w-4" />
                  随机
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">留空系统自动生成随机 key</p>
            </div>

            <DialogFooter className="sm:justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
                取消
              </Button>
              <Button onClick={onCreate} disabled={create.isPending}>
                {create.isPending ? <Spinner /> : null}
                创建
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- 换绑（重新绑定到另一个个人 model） ---------------- */

function RebindDialog({
  open,
  onOpenChange,
  target,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  target: KeyView | null;
}) {
  const rebind = useRebindKey();
  const profiles = useProfiles();
  const [selected, setSelected] = useState("");

  // 打开时默认选中目标当前绑定的 model
  useEffect(() => {
    if (open && target) setSelected(target.profileId);
  }, [open, target]);

  async function onRebind() {
    if (!target || !selected || selected === target.profileId) {
      toast.error("请选择要换绑到的个人 model");
      return;
    }
    try {
      await rebind.mutateAsync({ id: target.id, profileId: selected });
      toast.success(`已将「${target.name}」换绑到新个人 model`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "换绑失败");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !rebind.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>换绑「{target?.name}」</DialogTitle>
          <DialogDescription>
            把它重新绑定到另一个个人 model（子 agent）。换绑后即只能调用新的那一个。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="换绑到个人 model（子 agent）*" htmlFor="rebind-profile">
            <Select value={selected || undefined} onValueChange={setSelected}>
              <SelectTrigger id="rebind-profile" className="w-full">
                <SelectValue placeholder="选一个个人 model" />
              </SelectTrigger>
              <SelectContent>
                {profiles.data?.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <DialogFooter className="sm:justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={rebind.isPending}>
              取消
            </Button>
            <Button onClick={onRebind} disabled={rebind.isPending}>
              {rebind.isPending ? <Spinner /> : null}
              换绑
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
