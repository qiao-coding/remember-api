"use client";

/* 数据层约定（web-ux/04 §4）：统一 apiFetch + 标准 query key。
 * 页面只消费本文件 hooks，不再散写 fetch + 手拼 header。 */

import { useMemo } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { memoryQueryString, type MemoryQuery } from "./domain/memories";
import type {
  KeyCreated,
  KeyView,
  MemoryItem,
  MemoryType,
  ProfileView,
  ProjectView,
  ProviderView,
  SkillView,
  UsageBreakdown,
  UsageRow,
  UsageSummary,
} from "@/lib/types";

/* ---------- 负载类型（与 03-接口契约 §2–7 对齐） ---------- */

export interface ProfilePayload {
  name: string;
  provider: "deepseek";
  model: string;
  projectId: string;
  systemPrompt?: string | null;
  memoryEnabled?: boolean;
  memoryBudget?: number;
  skillIds?: string[];
  temperature?: number | null;
  maxTokens?: number | null;
}
export interface ProjectPayload {
  name: string;
  description?: string | null;
  summary?: string | null;
  architecture?: string | null;
  status?: string | null;
  decisions?: string[];
  knownIssues?: string[];
}
export interface SkillPayload {
  name: string;
  description?: string | null;
  content: string;
}
export interface ProviderPayload {
  provider: string;
  baseUrl?: string | null;
  defaultModel?: string | null;
  apiKey?: string;
}
export interface MemoryPayload {
  content: string;
  type: MemoryType;
  importance?: number;
  pinned?: boolean;
  projectId?: string | null;
}

/* ---------- query keys（标准，供 invalidate 用） ---------- */

export type MemoryFilter = MemoryQuery;

export const QK = {
  profiles: ["profiles"] as const,
  projects: ["projects"] as const,
  skills: ["skills"] as const,
  keys: ["keys"] as const,
  providers: ["providers"] as const,
  memories: (f: MemoryFilter) => ["memories", f] as const,
  memoryOne: (id: string) => ["memories", "one", id] as const,
  usageSummary: (days: number) => ["usage", "summary", days] as const,
  usageRequests: (limit: number) => ["usage", "requests", limit] as const,
  usageBreakdown: (groupBy: "profile" | "project", days: number) =>
    ["usage", "breakdown", groupBy, days] as const,
  dashboard: ["dashboard"] as const,
};

/* ---------- 列表 / 汇总读取 ---------- */

export function useProfiles() {
  return useQuery({
    queryKey: QK.profiles,
    queryFn: () => apiFetch<ProfileView[]>("/api/profiles"),
  });
}
export function useProjects() {
  return useQuery({
    queryKey: QK.projects,
    queryFn: () => apiFetch<ProjectView[]>("/api/projects"),
  });
}
export function useSkills() {
  return useQuery({
    queryKey: QK.skills,
    queryFn: () => apiFetch<SkillView[]>("/api/skills"),
  });
}
export function useKeys() {
  return useQuery({
    queryKey: QK.keys,
    queryFn: () => apiFetch<KeyView[]>("/api/keys"),
  });
}
export function useProviders() {
  return useQuery({
    queryKey: QK.providers,
    queryFn: () => apiFetch<ProviderView[]>("/api/providers"),
  });
}

export function useMemories(f: MemoryFilter) {
  const qs = memoryQueryString(f);
  return useQuery({
    queryKey: QK.memories(f),
    placeholderData: keepPreviousData,
    queryFn: () => apiFetch<MemoryItem[]>(`/api/memories?${qs}`),
  });
}

/** 单条记忆（全局搜索 focus 兜底：目标被当前筛选排除时仍可拉取展示）。 */
export function useMemoryOne(id: string | null) {
  return useQuery({
    queryKey: QK.memoryOne(id ?? ""),
    enabled: !!id,
    queryFn: () => apiFetch<MemoryItem>(`/api/memories/${encodeURIComponent(id!)}`),
  });
}

export function useUsageSummary(days: number) {
  return useQuery({
    queryKey: QK.usageSummary(days),
    queryFn: () => apiFetch<UsageSummary>(`/api/usage/summary?days=${days}`),
  });
}
export function useUsageRequests(limit: number) {
  return useQuery({
    queryKey: QK.usageRequests(limit),
    queryFn: () => apiFetch<UsageRow[]>(`/api/usage/requests?limit=${limit}`),
  });
}
export function useUsageBreakdown(groupBy: "profile" | "project", days: number) {
  return useQuery({
    queryKey: QK.usageBreakdown(groupBy, days),
    queryFn: () =>
      apiFetch<UsageBreakdown[]>(`/api/usage/breakdown?groupBy=${groupBy}&days=${days}`),
  });
}

/* ---------- 名称 join map（usage/memories 把 id 显示成名称） ---------- */

export function useNameMaps() {
  const profiles = useProfiles();
  const projects = useProjects();
  const profileName = useMemo(() => {
    const m = new Map<string, string>();
    profiles.data?.forEach((p) => m.set(p.id, p.name));
    return m;
  }, [profiles.data]);
  const projectName = useMemo(() => {
    const m = new Map<string, string>();
    projects.data?.forEach((p) => m.set(p.id, p.name));
    return m;
  }, [projects.data]);
  return { profileName, projectName, profiles, projects };
}

/* ---------- 变更（typed；成功即失效对应 query key） ---------- */

export function useCreateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ProfilePayload) =>
      apiFetch<{ id: string }>("/api/profiles", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: QK.profiles }),
  });
}
export function useUpdateProfile(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<ProfilePayload>) =>
      apiFetch<{ ok: true }>(`/api/profiles/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: QK.profiles }),
  });
}
export function useDeleteProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: true }>(`/api/profiles/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: QK.profiles }),
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ProjectPayload) =>
      apiFetch<{ id: string }>("/api/projects", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: QK.projects }),
  });
}
export function useUpdateProject(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<ProjectPayload>) =>
      apiFetch<{ ok: true }>(`/api/projects/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: QK.projects }),
  });
}
export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: true }>(`/api/projects/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: QK.projects }),
  });
}

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: SkillPayload) =>
      apiFetch<{ id: string }>("/api/skills", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: QK.skills }),
  });
}
export function useUpdateSkill(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<SkillPayload>) =>
      apiFetch<{ ok: true }>(`/api/skills/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: QK.skills }),
  });
}
export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: true }>(`/api/skills/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: QK.skills }),
  });
}

export function useCreateKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      name: string;
      profileId: string;
      secret?: string;
    }) =>
      apiFetch<KeyCreated>("/api/keys", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: QK.keys }),
  });
}
export function useSetKeyDisabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, disabled }: { id: string; disabled: boolean }) =>
      apiFetch<{ ok: true }>(`/api/keys/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ disabled }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: QK.keys }),
  });
}
export function useRebindKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, profileId }: { id: string; profileId: string }) =>
      apiFetch<{ ok: true }>(`/api/keys/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ profileId }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: QK.keys }),
  });
}
export function useDeleteKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: true }>(`/api/keys/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: QK.keys }),
  });
}

export function useUpsertProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ProviderPayload) =>
      apiFetch<{ id: string }>("/api/providers", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: QK.providers }),
  });
}
export function useDeleteProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: true }>(`/api/providers/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: QK.providers }),
  });
}

export function useCreateMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: MemoryPayload) =>
      apiFetch<MemoryItem>("/api/memories", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: QK.memories({}) }),
  });
}
export function useUpdateMemory(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<MemoryPayload>) =>
      apiFetch<MemoryItem>(`/api/memories/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: QK.memories({}) }),
  });
}
export function useDeleteMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: true }>(`/api/memories/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: QK.memories({}) }),
  });
}
