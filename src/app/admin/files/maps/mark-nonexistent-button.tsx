"use client";

import { useState } from "react";
import { Ghost } from "lucide-react";
import { markMapNonexistent } from "./rename-action";

interface Props {
  filename: string;
}

/** Two-step rename control on the map detail page — adds the
 *  `NEEXISTUJE-` prefix to mark a location as defunct. The rename
 *  is what makes the entry disappear from sync.ts (the parser
 *  expects the location code to be the first `+`-separated
 *  segment, and the prefix breaks that). */
export function MarkMapNonexistentButton({ filename }: Props) {
  const [confirming, setConfirming] = useState(false);

  if (filename.startsWith("NEEXISTUJE-")) {
    return (
      <span
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs font-medium text-gray-500"
        title="Tato mapa už je označená jako zaniklá"
      >
        <Ghost className="h-3.5 w-3.5" aria-hidden />
        Zaniklá
      </span>
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
