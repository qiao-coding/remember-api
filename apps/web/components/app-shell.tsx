"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  BookOpen,
  Braces,
  ChevronDown,
  CreditCard,
  FolderKanban,
  KeyRound,
  LayoutDashboard,
  LogOut,
  NotebookPen,
  Settings,
  Shapes,
  type LucideIcon,
} from "lucide-react";
import { createSupabaseBrowser } from "@/lib/auth";
import { cn } from "@/lib/cn";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { GlobalSearch } from "./global-search";
import { ThemeToggle } from "./theme-toggle";
import { RouteTransition } from "./route-transition";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/docs", label: "Docs", icon: BookOpen },
  { href: "/profiles", label: "Profiles", icon: Braces },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/memories", label: "Memories", icon: NotebookPen },
  { href: "/skills", label: "Skills", icon: Shapes },
  { href: "/usage", label: "Usage", icon: Activity },
  { href: "/keys", label: "API Keys", icon: KeyRound },
  { href: "/providers", label: "Providers", icon: CreditCard },
  { href: "/settings", label: "Settings", icon: Settings },
];

const TITLE_MAP: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/profiles": "Profiles",
  "/projects": "Projects",
  "/memories": "Memories",
  "/skills": "Skills",
  "/usage": "Usage",
  "/keys": "API Keys",
  "/providers": "Providers",
  "/settings": "Settings",
};

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** 品牌 mark：remember-api 官方 logo（public/brand/remember-logo.png）。 */
function ShellLogo({ className }: { className?: string }) {
  return (
    <Image
      src="/brand/remember-logo.png"
      alt=""
      width={20}
      height={20}
      className={cn("size-5 shrink-0", className)}
    />
  );
}

/** 导航项：移动端(抽屉)点击即收起，由官方 useSidebar 驱动。 */
function ShellNav() {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();

  return (
    <>
      {NAV.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <SidebarMenuItem key={item.href}>
            <SidebarMenuButton
              asChild
              isActive={active}
              tooltip={item.label}
              onClick={() => {
                if (isMobile) setOpenMobile(false);
              }}
            >
              <Link href={item.href} aria-current={active ? "page" : undefined}>
                <item.icon />
                <span>{item.label}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </>
  );
}

export function AppShell({
  children,
  userEmail,
}: {
  children: React.ReactNode;
  userEmail?: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const title = useMemo(() => {
    const exact = TITLE_MAP[pathname];
    if (exact) return exact;
    return NAV.find((n) => pathname.startsWith(`${n.href}/`))?.label ?? "Console";
  }, [pathname]);

  const initials = (userEmail ?? "?").slice(0, 2).toUpperCase();

  const signOut = async () => {
    const supabase = createSupabaseBrowser();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  };

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <Link
            href="/dashboard"
            aria-label="remember-api 控制台"
            className="flex h-9 items-center gap-2 rounded-md px-2 transition group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
          >
            <ShellLogo />
            <span className="truncate text-sm font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
              remember-api
            </span>
          </Link>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>控制台</SidebarGroupLabel>
            <SidebarMenu>
              <ShellNav />
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          <div className="p-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="h-10 w-full justify-start gap-2 px-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
                  aria-label="账号菜单"
                >
                  <Avatar className="h-6 w-6 shrink-0">
                    <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-xs font-medium">
                      {userEmail ?? "已登录"}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      单用户实例
                    </span>
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                side="right"
                sideOffset={8}
                className="w-56 min-w-[var(--radix-dropdown-menu-trigger-width)]"
              >
                <DropdownMenuLabel className="font-normal">
                  <p className="truncate text-sm font-medium">{userEmail ?? "已登录"}</p>
                  <p className="text-xs font-normal text-muted-foreground">单用户实例</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => router.push("/settings")}>
                  <Settings className="h-4 w-4" />
                  设置
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={signOut}
                >
                  <LogOut className="h-4 w-4" />
                  退出登录
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </SidebarFooter>

        <SidebarRail />
      </Sidebar>

      <SidebarInset className="bg-background">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b bg-background/70 px-4 backdrop-blur-xl sm:px-6">
          <SidebarTrigger className="-ml-1" />

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="hidden h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--ring))] sm:block"
              />
              <p className="truncate text-[15px] font-semibold tracking-tight">{title}</p>
            </div>
            <p className="hidden text-xs text-muted-foreground sm:block">
              Stateful Personal AI · OpenAI 兼容网关控制台
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            <GlobalSearch />
            <ThemeToggle />
          </div>
        </header>

        <div className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <RouteTransition>{children}</RouteTransition>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
