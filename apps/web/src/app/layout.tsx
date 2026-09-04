import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Localization Release Commander",
  description: "From picture lock to publishable delivery.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
