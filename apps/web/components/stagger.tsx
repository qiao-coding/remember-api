"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";

/** 块级入场错峰（direct children stagger）。用于面板/卡片集。 */
export function Stagger({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        el.children,
        { opacity: 0, y: 10 },
        { opacity: 1, y: 0, duration: 0.36, stagger: 0.05, delay, ease: "power2.out", overwrite: true },
      );
    }, el);
    return () => ctx.revert();
  }, [delay]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
