"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import {
  deleteWholePhotoCropsAction,
  type DeleteCropsResult,
} from "./delete-crops-action";

/**
 * Bulk-deletes every crop flagged by the "crop is really the whole photo"
 * check. Two-step confirm because it's destructive; the crops move to
 * `data/.trash/` (recoverable) and the CROP rows are removed so the finds
 * cleanly show no crop. Meant for the "fix the crops elsewhere, re-upload,
 * sync" workflow.
 */
export function DeleteAllCropsButton({ count }: { count: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<DeleteCropsResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const run = () => {
    startTransition(async () => {
      const r = await deleteWholePhotoCropsAction();
      setResult(r);
      setConfirming(false);
      if (r.ok) router.refresh();
    });
  };

  if (result?.ok) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
        Přesunuto {result.trashed} ořezů do koše · smazáno {result.rowsDeleted}{" "}
        řádků
      </span>
    );
  }

  if (confirming) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-red-700">
          Opravdu smazat {count} ořezů? (do koše)
        </span>
        <button
          type="button"
          onClick={run}
          disabled={isPending}
          className="inline-flex items-center gap-1 rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
        >
          {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Ano, smazat
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={isPending}
          className="rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50"
        >
          Zrušit
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 shadow-sm transition hover:bg-red-50"
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
        Smazat všechny ořezy ({count})
      </button>
      {result && !result.ok && (
        <span className="text-xs text-red-600">{result.error}</span>
      )}
    </span>
  );
}
