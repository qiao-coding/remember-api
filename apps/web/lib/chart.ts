"use client";

import { useLayoutEffect, useState } from "react";
import { useTheme } from "next-themes";

const FALLBACK = ["hsl(221 83% 53%)", "hsl(173 58% 39%)", "hsl(35 92% 47%)", "hsl(262 83% 58%)", "hsl(340 75% 55%)"];

/** 读取 globals.css 的 --chart-N 与文本/边框色为可用颜色串；主题切换时重算。
 * 背景用 document.documentElement 计算样式；颜色以 hsl(...) 字符串返回（SVG fill 需要具体色值）。 */
export function useChartColors() {
  const { resolvedTheme } = useTheme();
  const [colors, setColors] = useState<string[]>(FALLBACK);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const cs = getComputedStyle(document.documentElement);
    const read = (name: string) => {
      const v = cs.getPropertyValue(name).trim();
      return v ? `hsl(${v})` : undefined;
    };
    const chart = [1, 2, 3, 4, 5].map((i) => read(`--chart-${i}`)).filter((x): x is string => !!x);
    setColors(chart.length >= 2 ? chart : FALLBACK);
  }, [resolvedTheme]);

  return colors;
}
