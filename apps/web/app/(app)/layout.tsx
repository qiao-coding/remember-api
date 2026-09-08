import { redirect } from "next/navigation";
import { createSupabaseServer } from "../../lib/server-auth";
import { AppShell } from "../../components/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell userEmail={user.email}>{children}</AppShell>
  );
}
