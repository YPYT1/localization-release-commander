import { AppShell } from "@/components/app-shell";
import { ConnectionNotice } from "@/components/data-states";
import { api, AUTH_COOKIE } from "@/lib/api";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get(AUTH_COOKIE)?.value;
  if (!token) redirect("/login");

  const [health, identity] = await Promise.all([api.health(), api.me()]);
  if (!identity.ok && identity.kind === "unauthorized") redirect("/login?expired=1");
  if (!identity.ok) return <AppShell health={health} principal={null}><ConnectionNotice result={identity} /></AppShell>;
  return <AppShell health={health} principal={identity.data}>{children}</AppShell>;
}
