import { notFound } from "next/navigation";
import { DocsBody, DocsPage } from "fumadocs-ui/page";
import { AuthProvider } from "@/components/docs/auth-provider";
import { getServerUser } from "@/lib/server-auth";
import { source } from "@/lib/source";

// 该页比 [[...slug]] 更具体：独立读 cookie，只有 quickstart 是动态渲染。
export const dynamic = "force-dynamic";

export default async function QuickstartPage() {
  const user = await getServerUser();
  const page = source.getPage(["quickstart"]);
  if (!page) notFound();

  const MDX = page.data.body;

  return (
    <DocsPage toc={page.data.toc}>
      <DocsBody>
        <AuthProvider authed={!!user}>
          <MDX />
        </AuthProvider>
      </DocsBody>
    </DocsPage>
  );
}

export async function generateMetadata() {
  const page = source.getPage(["quickstart"]);
  return { title: page?.data.title };
}
