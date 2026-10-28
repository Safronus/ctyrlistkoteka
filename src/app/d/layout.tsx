import type { Metadata } from "next";
import { RootShell } from "@/components/root-shell";
import { buildRootMetadata } from "@/lib/rootMetadata";

// Root layout of the landing pages of the 111 cards given away into the world (/d/<token>): Czech-only, outside `[locale]`. Each
// top-level section has its own root — see RootShell. The page's own
// metadata (noindex) is merged on top of this.
export function generateMetadata(): Metadata {
  return buildRootMetadata("cs");
}

export default function DRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <RootShell lang="cs">{children}</RootShell>;
}
