import { notFound } from "next/navigation";
import { DocsBody, DocsPage } from "fumadocs-ui/page";
import { source } from "@/lib/source";

type Params = { params: Promise<{ slug?: string[] }> };

export default async function DocPage({ params }: Params) {
  const slug = (await params).slug ?? [];
  const page = source.getPage(slug);
  if (!page) notFound();

  const MDX = page.data.body;

  return (
    <DocsPage toc={page.data.toc}>
      <DocsBody>
        <MDX />
      </DocsBody>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata({ params }: Params) {
  const slug = (await params).slug ?? [];
  const page = source.getPage(slug);
  return { title: page?.data.title };
}
