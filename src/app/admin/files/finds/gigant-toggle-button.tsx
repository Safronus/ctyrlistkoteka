"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { toggleFindGigant } from "./gigant-action";

interface Props {
  filename: string;
  /** Current GIGANT state read from the parsed states list on the
   *  detail page (or false for files that don't have a parseable
   *  filename, in which case the button is hidden upstream). */
  currentlyGigant: boolean;
}

/** Detail-page toggle for the cosmetic GIGANT state. Single click in
 *  either direction — adding or removing the marker — because the
 *  flag has no public-side consequences beyond a badge: nothing to
 *  confirm. The server action edits
 *  `LokaceStavyPoznamky.json → stavy.GIGANT` atomically; the next
 *  sync writes the corresponding `findStateAssignment(GIGANT)` row. */
export function FindGigantToggleButton({
  filename,
  currentlyGigant,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const submit = () => {
    setError(null);
    const fd = new FormData();
    fd.append("name", filename);
    fd.append("mark", currentlyGigant ? "0" : "1");
    startTransition(async () => {
      const r = await toggleFindGigant(fd);
      if (!r.ok) {
        setError(r.error ?? "Neznámá chyba");
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={submit}
        disabled={isPending}
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
          currentlyGigant
            ? "border-emerald-300 bg-emerald-100 text-emerald-900 hover:border-emerald-400 hover:bg-emerald-200"
            : "border-emerald-200 bg-white text-emerald-800 hover:border-emerald-300 hover:bg-emerald-50"
        }`}
      >
        {isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
        )}
        {currentlyGigant ? "Zrušit Gigant" : "Označit jako Gigant"}
      </button>
      {error && (
        <p className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}
