"use client";

import { useState, useTransition } from "react";
import { Loader2, ShieldOff } from "lucide-react";
import { anonymizeAnonLocationFinds } from "./anonymize-anon-loc-action";

/** One-click "anonymise all offenders" for the finds-in-anon-loc check.
 *  Renames the finds' photos (pole 5 → ANO) + mirrors into the JSON; the
 *  operator still runs `pnpm sync` to land it in the DB (the toast says so).
 *  No confirm dialog — the op is reversible (de-anonymise the map, or edit
 *  the JSON) and the `.trash` snapshot covers the JSON. */
export function AnonymizeAnonLocFindsButton({ count }: { count: number }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    setMsg(null);
    startTransition(async () => {
      const r = await anonymizeAnonLocationFinds();
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
        title="Anonymizovat pole 5 v názvech + JSON pro všechny nálezy na anonymizovaných lokalitách"
        className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 shadow-sm transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <ShieldOff className="h-3.5 w-3.5" aria-hidden />
        )}
        Anonymizovat všechny ({count})
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
