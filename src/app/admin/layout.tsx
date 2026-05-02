import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  FileJson,
  FolderTree,
  Gauge,
  ShieldCheck,
} from "lucide-react";
import { getAdminSession, isAuthenticated } from "@/lib/admin/session";
import { LogoutButton } from "./logout-button";

export const metadata: Metadata = {
  // Robots get told no-index by the meta tag and by the route's
  // x-robots-tag header (set in middleware) — admin should never
  // appear in any search index.
  robots: { index: false, follow: false },
};

// /admin pages mutate filesystem + DB on demand and must always reflect
// the current auth state — caching would defeat the guard.
export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getAdminSession();
  const authed = isAuthenticated(session);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link
            href="/admin"
            className="inline-flex shrink-0 items-center gap-2 text-sm font-semibold text-gray-900"
          >
            <ShieldCheck className="h-5 w-5 text-brand-600" aria-hidden />
            <span className="hidden sm:inline">Čtyřlístkotéka — admin</span>
            <span className="sm:hidden">admin</span>
          </Link>
          {authed && (
            <>
              <nav
                aria-label="Admin sekce"
                className="flex flex-1 items-center justify-center gap-1 text-sm"
              >
                <NavLink href="/admin" icon={Gauge} label="Přehled" />
                <NavLink href="/admin/files" icon={FolderTree} label="Soubory" />
                <NavLink
                  href="/admin/json/lokace-stavy-poznamky"
                  icon={FileJson}
                  label="JSON"
                />
                <NavLink href="/admin/audit" icon={Activity} label="Audit" />
              </nav>
              <div className="flex shrink-0 items-center gap-3 text-sm text-gray-600">
                <span className="hidden lg:inline">
                  Přihlášen jako{" "}
                  <strong className="font-medium text-gray-900">
                    {session.credentialLabel}
                  </strong>
                </span>
                <LogoutButton />
              </div>
            </>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}

function NavLink({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: typeof ShieldCheck;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-gray-700 transition hover:bg-gray-100 hover:text-gray-900"
    >
      <Icon className="h-4 w-4" aria-hidden />
      <span>{label}</span>
    </Link>
  );
}
