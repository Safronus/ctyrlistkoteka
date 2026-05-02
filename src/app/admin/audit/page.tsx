import { Activity } from "lucide-react";
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

export default async function AdminAuditPage() {
  await ensureAdminAuth();
  // Pull a generous window — the file is JSONL so a few hundred rows
  // is still cheap. Pagination can land later if it gets unwieldy.
  const rows = await readRecentAudit(500);

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

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-sm text-gray-500">
          Zatím žádné záznamy.
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
