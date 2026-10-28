import type { Metadata } from "next";
import { RootShell } from "@/components/root-shell";
import { buildRootMetadata } from "@/lib/rootMetadata";

// Root layout of the password-protected crew map (/tym/<token>): Czech-only, outside `[locale]`. Each
// top-level section has its own root — see RootShell. The page's own
// metadata (noindex) is merged on top of this.
export function generateMetadata(): Metadata {
  return buildRootMetadata("cs");
}

export default function TymRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <RootShell lang="cs">{children}</RootShell>;
}
