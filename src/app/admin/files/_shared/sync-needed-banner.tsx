import Link from "next/link";
import { CheckCircle2, Database, Zap } from "lucide-react";
import type { SyncNeededResult, SyncScope } from "@/lib/admin/syncNeeded";

interface Props {
  /** Result of `checkSyncNeeded([scope])`. */
  result: SyncNeededResult;
  /** Scope to pre-fill on the sync panel. Becomes `?preset=<scope>`. */
  preset: SyncScope;
  /** Free-form context the user sees. Goes in the heading. */
  label: string;
}

/** Renders an inline banner above a listing / preview saying whether
 *  the public DB matches the disk state. Green when nothing has
 *  changed since the last successful sync; amber with a "Spustit
 *  sync" shortcut otherwise. The shortcut carries the scope as a
 *  query param so the panel pre-selects the right `--only` filter
 *  and toggles dry-run on by default. */
export function SyncNeededBanner({ result, preset, label }: Props) {
  if (!result.needed) {
    return (
      <p className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-900">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
        {label} jsou ve stavu posledního syncu (
        {result.lastSuccessAt
          ? new Date(result.lastSuccessAt).toLocaleString("cs-CZ", {
              timeZone: "Europe/Prague",
            })
          : "—"}
        ).
      </p>
    );
  }

  const href = `/admin/sync?preset=${encodeURIComponent(preset)}`;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <span className="inline-flex items-center gap-1.5">
        <Database className="h-3.5 w-3.5" aria-hidden />
        {label} se od posledního syncu změnily
        {result.lastSuccessAt && (
          <>
            {" "}(naposledy{" "}
            <time
              dateTime={result.lastSuccessAt}
              className="font-mono tabular-nums"
            >
              {new Date(result.lastSuccessAt).toLocaleString("cs-CZ", {
                timeZone: "Europe/Prague",
              })}
            </time>
            )
          </>
        )}
        {!result.lastSuccessAt && " (sync se zatím neúspěšně nedoběhl)"}.
      </span>
      <Link
        href={href}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-amber-400 bg-white px-2.5 py-1 font-medium text-amber-900 transition hover:bg-amber-100"
      >
        <Zap className="h-3.5 w-3.5" aria-hidden />
        Spustit sync (--only={preset})
      </Link>
    </div>
  );
}
