import { MarketingFooter, MarketingHeader } from "@/components/marketing";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <div className="marketing-site"><MarketingHeader /><main id="main-content">{children}</main><MarketingFooter /></div>;
}
