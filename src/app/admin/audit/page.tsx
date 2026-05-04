import Link from "next/link";
import { Activity, FilterX } from "lucide-react";
import { ensureAdminAuth } from "@/lib/admin/guard";
import { readRecentAudit, type AuditAction } from "@/lib/admin/audit";
import { AuditSubNav } from "./_subnav";

const ACTION_LABELS: Record<AuditAction, string> = {
  "auth.register": "Registrace passkey",
  "auth.login": "Přihlášení",
  "auth.logout": "Odhlášení",
  "auth.failed": "Neúspěšné ověření",
  "file.upload": "Upload souboru",
  "file.delete": "Smazání souboru",
  "file.replace": "Přepsání souboru",
  "file.rename": "Přejmenování souboru",
  "file.restore": "Obnova z koše",
  "json.update": "Úprava JSONu",
  "sync.start": "Sync — start",
  "sync.finish": "Sync — konec",
  "sync.fail": "Sync — chyba",
};

const ACTION_TONE: Record<AuditAction, string> = {
  "auth.register": "bg-emerald-100 text-emerald-800",
  "auth.login": "bg-brand-100 text-brand-800",
  "auth.logout": "bg-gray-100 text-gray-700",
  "auth.failed": "bg-rose-100 text-rose-800",
  "file.upload": "bg-blue-100 text-blue-800",
  "file.delete": "bg-amber-100 text-amber-800",
  "file.replace": "bg-amber-100 text-amber-800",
  "file.rename": "bg-amber-100 text-amber-800",
  "file.restore": "bg-emerald-100 text-emerald-800",
  "json.update": "bg-violet-100 text-violet-800",
  "sync.start": "bg-cyan-100 text-cyan-800",
  "sync.finish": "bg-emerald-100 text-emerald-800",
  "sync.fail": "bg-rose-100 text-rose-800",
};

/** Toggle ordering = visual ordering. Grouped (auth → file → json →
 *  sync) so the related actions stay neighbours; inside each group
 *  the most useful filter sits leftmost. */
const TOGGLE_ORDER: readonly AuditAction[] = [
  "auth.login",
  "auth.failed",
  "auth.register",
  "auth.logout",
  "file.upload",
  "file.delete",
  "file.replace",
  "file.rename",
  "file.restore",
  "json.update",
  "sync.start",
  "sync.finish",
  "sync.fail",
] as const;

const ALL_ACTIONS = new Set<AuditAction>(TOGGLE_ORDER);

/** Parse the comma-separated `?actions=` query into a set of valid
 *  AuditAction values. Invalid tokens are silently dropped — bad
 *  links shouldn't crash the page, just behave like "no filter". */
function parseActiveActions(raw: string | string[] | undefined): Set<AuditAction> {
  const out = new Set<AuditAction>();
  if (!raw) return out;
  const value = Array.isArray(raw) ? raw.join(",") : raw;
  for (const token of value.split(",")) {
    const trimmed = token.trim();
    if (ALL_ACTIONS.has(trimmed as AuditAction)) {
      out.add(trimmed as AuditAction);
    }
  }
  return out;
}

/** Build the `?actions=` href that toggles `target` in the current
 *  selection. If `target` is already active, it leaves; if not, it
 *  joins. An empty selection clears the param entirely so the URL
 *  stays clean. */
function toggleHref(active: Set<AuditAction>, target: AuditAction): string {
  const next = new Set(active);
  if (next.has(target)) next.delete(target);
  else next.add(target);
  if (next.size === 0) return "/admin/audit";
  // Order doesn't matter functionally — the parser treats the query
  // as a set — but keeping it stable across renders avoids "URL
  // shifts under hover" jitter. TOGGLE_ORDER mirrors the visual
  // ordering and is the right canonical sort here.
  const sorted = TOGGLE_ORDER.filter((a) => next.has(a));
  return `/admin/audit?actions=${sorted.join(",")}`;
}

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await ensureAdminAuth();
  const sp = await searchParams;
  const activeActions = parseActiveActions(sp.actions);

  // Pull a generous window — the file is JSONL so a few hundred rows
  // is still cheap. Pagination can land later if it gets unwieldy.
  const allRows = await readRecentAudit(500);

  // Counts pre-filter: how many rows of each kind exist in the
  // current 500-row window. Surfacing this on the toggle pill lets
  // the user see at a glance which kinds are even worth filtering
  // for — a kind with 0 events doesn't need a click.
  const counts: Partial<Record<AuditAction, number>> = {};
  for (const r of allRows) {
    counts[r.action] = (counts[r.action] ?? 0) + 1;
  }

  // Apply filter. Empty set = pass-through (the natural reading of
  // "no filter selected" is "show everything"). When the filter is
  // active, only matching rows survive.
  const rows =
    activeActions.size === 0
      ? allRows
      : allRows.filter((r) => activeActions.has(r.action));

  const filterActive = activeActions.size > 0;

  return (
    <div className="space-y-4">
      <AuditSubNav active="log" />

      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
          <Activity className="h-5 w-5 text-brand-600" aria-hidden />
          Audit log
        </h1>
        <p className="text-sm text-gray-500">
          Append-only JSONL záznam admin akcí — auth + budoucí mutace souborů.
          Soubor: <code>/var/ctyrlistkoteka/secure/admin-audit.log</code>.
        </p>
      </header>

      <section
        aria-labelledby="audit-filter-heading"
        className="rounded-xl border border-gray-200 bg-white p-3"
      >
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2
            id="audit-filter-heading"
            className="text-xs font-semibold uppercase tracking-wide text-gray-500"
          >
            Filtr akcí
          </h2>
          <p className="text-xs text-gray-500">
            {filterActive ? (
              <>
                Zobrazeno{" "}
                <strong className="font-semibold text-gray-700">
                  {rows.length}
                </strong>{" "}
                z {allRows.length} záznamů
              </>
            ) : (
              <>
                Bez filtru — všech{" "}
                <strong className="font-semibold text-gray-700">
                  {allRows.length}
                </strong>{" "}
                záznamů
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TOGGLE_ORDER.map((action) => {
            const count = counts[action] ?? 0;
            const isActive = activeActions.has(action);
            // Disabled-look for kinds with no events in the window:
            // still clickable (filter-by-zero is occasionally useful
            // — confirms emptiness), just visually de-emphasised.
            const empty = count === 0;
            const base =
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition";
            const variant = isActive
              ? "border-brand-500 bg-brand-600 text-white shadow-sm hover:bg-brand-700"
              : empty
                ? "border-gray-200 bg-gray-50 text-gray-400 hover:border-gray-300 hover:bg-gray-100"
                : "border-gray-300 bg-white text-gray-700 hover:border-brand-300 hover:bg-brand-50";
            return (
              <Link
                key={action}
                href={toggleHref(activeActions, action)}
                aria-pressed={isActive}
                className={`${base} ${variant}`}
              >
                <span>{ACTION_LABELS[action]}</span>
                <span
                  className={`rounded-full px-1.5 py-px text-[10px] tabular-nums ${
                    isActive
                      ? "bg-brand-800/40 text-white"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {count}
                </span>
              </Link>
            );
          })}
          {filterActive && (
            <Link
              href="/admin/audit"
              className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-600 transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-800"
            >
              <FilterX className="h-3 w-3" aria-hidden />
              Vyprázdnit filtr
            </Link>
          )}
        </div>
      </section>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-sm text-gray-500">
          {filterActive
            ? "Filtr neodpovídá žádnému záznamu v aktuálním okně."
            : "Zatím žádné záznamy."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Čas
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Akce
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Identita
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  IP
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Detaily
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row, i) => {
                const tone =
                  ACTION_TONE[row.action] ?? "bg-gray-100 text-gray-700";
                const label = ACTION_LABELS[row.action] ?? row.action;
                return (
                  <tr key={`${row.ts}-${i}`} className="text-xs">
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono tabular-nums text-gray-500">
                      {new Date(row.ts).toLocaleString("cs-CZ", {
                        timeZone: "Europe/Prague",
                      })}
                    </td>
                    <td className="px-3 py-1.5">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${tone}`}
                      >
                        {label}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-gray-700">
                      {row.credentialLabel ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono text-gray-500">
                      {row.ip}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[11px] text-gray-500">
                      {row.details
                        ? JSON.stringify(row.details)
                        : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
