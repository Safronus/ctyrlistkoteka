"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Loader2, RotateCcw } from "lucide-react";
import {
  resetCasqbScansAction,
  restoreCasqbAction,
  retireCasqbAction,
} from "../../casqb-actions";

/** The two destructive buttons on the stats page — confirm, act, refresh. */
export function StatsActions({
  id,
  label,
  archived,
  total,
}: {
  id: number;
  label: string;
  archived: boolean;
  total: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(key);
    setError(null);
    try {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Akce selhala");
      else router.refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={busy !== null || total === 0}
        onClick={() => {
          if (
            window.confirm(
              `Smazat všech ${total.toLocaleString("cs-CZ")} skenů kódu „${label}“? Nejde to vrátit.`,
            )
          ) {
            void run("reset", () => resetCasqbScansAction(id));
          }
        }}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 text-xs font-medium text-amber-900 transition hover:bg-amber-100 disabled:opacity-50"
      >
        {busy === "reset" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RotateCcw className="h-3.5 w-3.5" aria-hidden />}
        Vynulovat skeny
      </button>
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => void run("archive", () => (archived ? restoreCasqbAction(id) : retireCasqbAction(id)))}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
      >
        {busy === "archive" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : archived ? (
          <ArchiveRestore className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <Archive className="h-3.5 w-3.5" aria-hidden />
        )}
        {archived ? "Obnovit" : "Vyřadit"}
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}
