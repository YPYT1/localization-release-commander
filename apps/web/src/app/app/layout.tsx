import { AppShell } from "@/components/app-shell";
import { api } from "@/lib/api";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const health = await api.health();
  return <AppShell health={health}>{children}</AppShell>;
}
