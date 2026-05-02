"use client";

import { useState } from "react";
import { Ghost, RotateCcw } from "lucide-react";
import {
  markMapNonexistent,
  restoreMapNonexistent,
} from "./rename-action";

interface Props {
  filename: string;
}

/** Two-step rename control on the map detail page. Live maps see the
 *  "Označit jako zaniklou" path; maps already prefixed with
 *  NEEXISTUJE- get a "Obnovit" path that strips it back off. The
 *  prefix is what makes sync.ts skip the entry, so removing it
 *  restores the binding on the next sync. */
export function MarkMapNonexistentButton({ filename }: Props) {
  const [confirming, setConfirming] = useState(false);
  const isNonexistent = filename.startsWith("NEEXISTUJE-");

  if (isNonexistent) {
    if (!confirming) {
      return (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-emerald-200 bg-white px-2.5 py-1.5 text-xs font-medium text-emerald-800 transition hover:border-emerald-300 hover:bg-emerald-50"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          Obnovit
        </button>
      );
    }
    return (
      <form
        action={restoreMapNonexistent}
        className="inline-flex shrink-0 items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs"
      >
        <input type="hidden" name="name" value={filename} />
        <span className="text-emerald-900">
          Odebrat prefix <code className="font-mono">NEEXISTUJE-</code>?
        </span>
        <button
          type="submit"
          className="rounded bg-emerald-600 px-2 py-0.5 font-medium text-white hover:bg-emerald-700"
        >
          Ano, obnovit
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded border border-gray-300 bg-white px-2 py-0.5 font-medium text-gray-700 hover:bg-gray-50"
        >
          Zrušit
        </button>
      </form>
    );
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-amber-200 bg-white px-2.5 py-1.5 text-xs font-medium text-amber-800 transition hover:border-amber-300 hover:bg-amber-50"
      >
        <Ghost className="h-3.5 w-3.5" aria-hidden />
        Označit jako zaniklou
      </button>
    );
  }

  return (
    <form
      action={markMapNonexistent}
      className="inline-flex shrink-0 items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs"
    >
      <input type="hidden" name="name" value={filename} />
      <span className="text-amber-900">
        Přejmenovat na <code className="font-mono">NEEXISTUJE-…</code>?
      </span>
      <button
        type="submit"
        className="rounded bg-amber-600 px-2 py-0.5 font-medium text-white hover:bg-amber-700"
      >
        Ano, označit
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="rounded border border-gray-300 bg-white px-2 py-0.5 font-medium text-gray-700 hover:bg-gray-50"
      >
        Zrušit
      </button>
    </form>
  );
}
