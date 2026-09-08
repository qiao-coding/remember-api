"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import gsap from "gsap";

/** 路由切换：页面内容淡入上移（中度动效，尊重 prefers-reduced-motion）。 */
export function RouteTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.fromTo(el, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.24, ease: "power2.out" });
    return () => {
      gsap.killTweensOf(el);
    };
  }, [pathname]);

  return <div ref={ref}>{children}</div>;
}
