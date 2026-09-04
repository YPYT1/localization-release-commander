import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://localization-release-commander.dev"),
  title: {
    default: "Localization Release Commander",
    template: "%s · Localization Release Commander",
  },
  description: "把字幕、配音、版权与平台规则，收束成一条可审计、可恢复的交付流程。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body><a className="skip-link" href="#main-content">跳到主要内容</a>{children}</body>
    </html>
  );
}
