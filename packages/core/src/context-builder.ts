import type { ChatMessage, MemoryType } from "@remember/shared";
import { estimateTokens } from "./token.js";

/**
 * Context Builder —— remember-api 最核心的自研模块。
 * 把 Profile / 用户偏好 / 项目上下文 / 检索记忆 / Skills / 客户端消息
 * 组装成最终发给底层模型的 messages，并记录各段 token 消耗。
 */

export interface ContextProject {
  name: string;
  summary?: string | null;
  architecture?: string | null;
  status?: string | null;
  decisions?: string[];
  knownIssues?: string[];
}

export interface ContextSkill {
  name: string;
  content: string;
}

export interface ContextMemoryItem {
  type: MemoryType;
  content: string;
}

export interface BuildContextInput {
  /** Profile.systemPrompt */
  profileSystemPrompt?: string | null;
  /** L0 用户偏好（已按预算裁剪） */
  preferences?: ContextMemoryItem[];
  /** L1 项目摘要 */
  project?: ContextProject | null;
  /** L2 检索到的相关记忆（已按预算裁剪） */
  retrievedMemories?: ContextMemoryItem[];
  /** Skills */
  skills?: ContextSkill[];
  /** Harness 对话 */
  messages: ChatMessage[];
}

export interface ContextBreakdown {
  profileTokens: number;
  preferenceTokens: number;
  projectTokens: number;
  memoryTokens: number;
  skillTokens: number;
  messageTokens: number;
}

interface Section {
  title: string;
  body: string;
}

export interface BuildContextResult {
  /** 最终发给模型的 messages（首条为 system） */
  messages: ChatMessage[];
  breakdown: ContextBreakdown;
}

export function buildContext(input: BuildContextInput): BuildContextResult {
  const sections: Section[] = [];

  if (input.profileSystemPrompt?.trim()) {
    sections.push({ title: "Profile", body: input.profileSystemPrompt.trim() });
  }

  const preferences = input.preferences ?? [];
  if (preferences.length) {
    sections.push({
      title: "User Preferences",
      body: preferences.map((p) => `- ${p.content.trim()}`).join("\n"),
    });
  }

  if (input.project) {
    const p = input.project;
    const parts: string[] = [`名称: ${p.name}`];
    if (p.summary) parts.push(`摘要: ${p.summary}`);
    if (p.architecture) parts.push(`架构: ${p.architecture}`);
    if (p.status) parts.push(`当前状态: ${p.status}`);
    if (p.decisions?.length) {
      parts.push(`重要决策:\n${p.decisions.map((d) => `- ${d}`).join("\n")}`);
    }
    if (p.knownIssues?.length) {
      parts.push(`已知问题:\n${p.knownIssues.map((i) => `- ${i}`).join("\n")}`);
    }
    sections.push({ title: "Project", body: parts.join("\n") });
  }

  const memories = input.retrievedMemories ?? [];
  if (memories.length) {
    sections.push({
      title: "Relevant Memory",
      body: memories.map((m) => `- (${m.type}) ${m.content.trim()}`).join("\n"),
    });
  }

  const skills = input.skills ?? [];
  if (skills.length) {
    sections.push({
      title: "Skills",
      body: skills.map((s) => `### ${s.name}\n${s.content.trim()}`).join("\n\n"),
    });
  }

  const systemText = sections.map((s) => `[${s.title}]\n${s.body}`).join("\n\n");
  const systemMessage: ChatMessage = {
    role: "system",
    content: systemText || null,
  };

  const messages: ChatMessage[] = [systemMessage, ...input.messages];
  const messageTokens = input.messages.reduce(
    (sum, m) => sum + estimateTokens(m.content ?? ""),
    0,
  );

  const breakdown: ContextBreakdown = {
    profileTokens: estimateTokens(
      sections.find((s) => s.title === "Profile")?.body ?? "",
    ),
    preferenceTokens: estimateTokens(
      sections.find((s) => s.title === "User Preferences")?.body ?? "",
    ),
    projectTokens: estimateTokens(
      sections.find((s) => s.title === "Project")?.body ?? "",
    ),
    memoryTokens: estimateTokens(
      sections.find((s) => s.title === "Relevant Memory")?.body ?? "",
    ),
    skillTokens: estimateTokens(
      sections.find((s) => s.title === "Skills")?.body ?? "",
    ),
    messageTokens,
  };

  return { messages, breakdown };
}
