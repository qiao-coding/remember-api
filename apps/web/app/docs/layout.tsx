import type { ReactNode } from "react";
import Image from "next/image";
import { RootProvider } from "fumadocs-ui/provider";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { source } from "@/lib/source";

import "fumadocs-ui/style.css";
import "fumadocs-ui/css/shadcn.css";

/** 公开 docs：Fumadocs 自带导航栏 + 侧栏 + TOC。主题/搜索交给根 Providers，这里关掉避免双份。 */
export default function DocsLayoutRoute({ children }: { children: ReactNode }) {
  return (
    <RootProvider theme={{ enabled: false }} search={{ enabled: false }}>
      <DocsLayout
        tree={source.pageTree}
        nav={{
          url: "/",
          title: (
            <span className="flex items-center gap-2">
              <Image
                src="/brand/remember-logo.png"
                alt="remember-api"
                width={22}
                height={22}
                className="rounded-md"
              />
              <span>remember-api</span>
            </span>
          ),
        }}
        links={[
          { type: "main", text: "主页", url: "/" },
          { type: "main", text: "控制台", url: "/dashboard" },
        ]}
        themeSwitch={{ enabled: false }}
        searchToggle={{ enabled: false }}
      >
        {children}
      </DocsLayout>
    </RootProvider>
  );
}
