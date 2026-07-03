"use client";

import { useState, useTransition } from "react";
import { Loader2, ShieldOff } from "lucide-react";

export interface AnonFixResult {
  ok: boolean;
  /** Finds targeted by the fix. */
  findsAffected?: number;
  /** Original photos renamed (pole 5 flipped); crops ride along. */
  photosRenamed?: number;
  /** Find IDs newly added to anonymizace.ANONYMIZOVANE. */
  jsonAdded?: number;
  /** Per-file rename failures (non-fatal — sync still enforces). */
  errors?: number;
  error?: string;
}

/** One-click bulk anonymisation fix for a /admin/checks card. The `action`
 *  re-derives its own offenders server-side (no stale client IDs) and
 *  renames their photos (pole 5 → ANO) + mirrors into the JSON; the toast
 *  reminds the operator to run sync. No confirm dialog — reversible (de-
 *  anonymise the map / edit the JSON) and the `.trash` snapshot covers it. */
export function AnonFixButton({
  count,
  label,
  action,
}: {
  count: number;
  label: string;
  action: () => Promise<AnonFixResult>;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    setMsg(null);
    startTransition(async () => {
      const r = await action();
      if (!r.ok) {
        setError(r.error ?? "Chyba");
        return;
      }
      setMsg(
        `Hotovo: ${r.findsAffected ?? 0} nálezů, přejmenováno ${
          r.photosRenamed ?? 0
        } fotek, do JSONu +${r.jsonAdded ?? 0}${
          r.errors ? `, chyby: ${r.errors}` : ""
        }. Teď spusť sync (--only=meta).`,
      );
    });
  };

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={submit}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 shadow-sm transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <ShieldOff className="h-3.5 w-3.5" aria-hidden />
        )}
        {label} ({count})
      </button>
      {msg && <p className="mt-1 text-[11px] text-emerald-800">{msg}</p>}
      {error && (
        <p className="mt-1 text-[11px] text-red-700" title={error}>
          {error}
        </p>
      )}
    </div>
  );
}
