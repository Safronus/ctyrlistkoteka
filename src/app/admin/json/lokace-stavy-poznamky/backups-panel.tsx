"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  History,
  Loader2,
  RotateCcw,
} from "lucide-react";
import type { BackupInfo } from "@/lib/admin/lspBackups";
import {
  restoreLspBackup,
  type RestoreBackupResult,
} from "./restore-backup-action";

function formatDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("cs-CZ", {
      dateStyle: "medium",
      timeStyle: "medium",
      timeZone: "Europe/Prague",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} kB`;
}

/** Read-only list of the last rotating backups of
 *  LokaceStavyPoznamky.json, each with a one-click restore (overwrites
 *  the live file after a confirm; the current file is itself backed up
 *  first, so a restore is reversible). */
export function BackupsPanel({ backups }: { backups: BackupInfo[] }) {
  const [result, setResult] = useState<RestoreBackupResult | null>(null);
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const restore = (name: string) => {
    if (
      !window.confirm(
        `Obnovit LokaceStavyPoznamky.json ze zálohy z ${formatDateTime(
          // name carries the timestamp; reuse the same parse path
          backups.find((b) => b.name === name)?.createdAtIso ?? name,
        )}?\n\nAktuální soubor se přepíše (před tím se sám zazálohuje).`,
      )
    ) {
      return;
    }
    setResult(null);
    setPendingName(name);
    const fd = new FormData();
    fd.append("name", name);
    startTransition(async () => {
      const r = await restoreLspBackup(fd);
      setResult(r);
      setPendingName(null);
      if (r.ok) router.refresh();
    });
  };

  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <header className="space-y-1">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-gray-900">
          <History className="h-4 w-4 text-brand-600" aria-hidden />
          Zálohy (posledních 10)
        </h2>
        <p className="text-xs text-gray-600">
          Před každým mergem (i obnovou) se uloží snímek souboru. Drží se
          posledních 10, starší se rotací odmažou. Obnova přepíše aktuální
          soubor — ten se ale nejdřív sám zazálohuje, takže je vratná.
        </p>
      </header>

      {backups.length === 0 ? (
        <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
          Zatím žádné zálohy — vytvoří se při prvním mergi.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
          {backups.map((b) => (
            <li
              key={b.name}
              className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
            >
              <div className="min-w-0">
                <p className="font-medium text-gray-900">
                  {formatDateTime(b.createdAtIso)}
                </p>
                <p className="font-mono text-[11px] text-gray-400">
                  {formatSize(b.sizeBytes)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => restore(b.name)}
                disabled={isPending}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isPending && pendingName === b.name ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                )}
                Obnovit
              </button>
            </li>
          ))}
        </ul>
      )}

      {result && result.ok && (
        <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
          <CheckCircle2
            className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"
            aria-hidden
          />
          <p>Soubor byl obnoven ze zálohy. Editor výše se načetl znovu.</p>
        </div>
      )}
      {result && !result.ok && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-900">
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-red-600"
            aria-hidden
          />
          <p>{result.error ?? "Obnova selhala."}</p>
        </div>
      )}
    </section>
  );
}
