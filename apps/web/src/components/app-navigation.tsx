"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AuthPrincipal } from "@/lib/api";

const navigation = [
  ["/app", "总览", "01", null],
  ["/app/releases", "交付版本", "02", null],
  ["/app/rulesets", "规则集", "03", null],
  ["/app/audit", "审计", "04", null],
  ["/app/settings", "设置", "05", "Admin"],
] as const;

export function AppNavigation({ principal }: { principal: AuthPrincipal | null }) {
  const pathname = usePathname();
  return <nav aria-label="工作台导航">{navigation.filter(([, , , role]) => !role || principal?.roles.includes("Admin")).map(([href, label, index]) => {
    const active = href === "/app" ? pathname === href : pathname.startsWith(href);
    return <Link key={href} href={href} aria-current={active ? "page" : undefined}><span>{index}</span>{label}</Link>;
  })}</nav>;
}
