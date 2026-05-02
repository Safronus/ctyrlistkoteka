import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
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
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
          <Link
            href="/admin"
            className="inline-flex items-center gap-2 text-sm font-semibold text-gray-900"
          >
            <ShieldCheck className="h-5 w-5 text-brand-600" aria-hidden />
            Čtyřlístkotéka — admin
          </Link>
          {authed && (
            <div className="flex items-center gap-3 text-sm text-gray-600">
              <span className="hidden sm:inline">
                Přihlášen jako{" "}
                <strong className="font-medium text-gray-900">
                  {session.credentialLabel}
                </strong>
              </span>
              <LogoutButton />
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
