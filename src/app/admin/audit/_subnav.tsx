import Link from "next/link";

/** Subnavigation shared by /admin/audit and /admin/audit/blocklist.
 *  The audit pages live under the same top-level "Audit" tab in the
 *  global header (see admin/layout.tsx); this is the second-level
 *  switch between the JSONL activity log and the fail2ban blocklist
 *  views. Server-rendered — the active state is set by the parent
 *  page so we don't need usePathname (which would force a client
 *  component for what's otherwise a static link bar). */
export function AuditSubNav({
  active,
}: {
  active: "log" | "blocklist";
}) {
  const linkBase =
    "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition";
  const activeCls = "border-brand-300 bg-brand-50 text-brand-800";
  const inactiveCls =
    "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50";
  return (
    <nav
      aria-label="Audit sekce"
      className="flex flex-wrap items-center gap-2 text-sm"
    >
      <Link
        href="/admin/audit"
        className={`${linkBase} ${active === "log" ? activeCls : inactiveCls}`}
      >
        Záznamy
      </Link>
      <Link
        href="/admin/audit/blocklist"
        className={`${linkBase} ${
          active === "blocklist" ? activeCls : inactiveCls
        }`}
      >
        Blocklist
      </Link>
    </nav>
  );
}
