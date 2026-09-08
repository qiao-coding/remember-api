import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// 公开页：产品首页 `/`、登录页、文档站 `/docs`（含子页，未登录可读）。
// 已登录访问 `/` 或登录页会由下方逻辑导回控制台；`/docs*` 对已登录用户保留停留。
function isPublicPath(path: string) {
  return (
    path === "/" ||
    path === "/login" ||
    path === "/docs" ||
    path.startsWith("/docs/")
  );
}

export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // /api 与 /v1 由 rewrite 直通 Fastify 后端，鉴权在服务端做，不进中间件
  if (path.startsWith("/api") || path.startsWith("/v1")) {
    return NextResponse.next();
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 未登录访问受保护页 → 跳登录
  if (!user && !isPublicPath(path)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  // 已登录访问首页/登录页 → 跳回 dashboard（docs 对已登录用户保持停留）
  if (user && (path === "/" || path === "/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export default async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
