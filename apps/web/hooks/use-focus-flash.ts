"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * 全局搜索跳转 `?focus=<id>` 的目标行短暂高亮。
 *
 * focus 非空 → 置 flashId 并在 `duration` 后清除；focus 为空/变化 → 重新计时。
 * profiles/projects/memories 三页原各自复刻同一 effect，此处收敛为一处。
 * 注：仅收敛去重（行为不变），高亮效果本身不做单测（低价值）。
 */
export function useFocusFlash(
  focus: string | null,
  duration = 1800,
): [string | null, () => void] {
  const [flashId, setFlashId] = useState<string | null>(null);

  useEffect(() => {
    if (!focus) return;
    setFlashId(focus);
    const t = window.setTimeout(() => setFlashId(null), duration);
    return () => window.clearTimeout(t);
  }, [focus, duration]);

  const clearFlash = useCallback(() => setFlashId(null), []);
  return [flashId, clearFlash];
}
