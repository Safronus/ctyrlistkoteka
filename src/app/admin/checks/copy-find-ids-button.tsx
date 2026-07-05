"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/**
 * Copies a check's offending find IDs to the clipboard (one per line) so
 * the operator can paste them elsewhere — e.g. to fix the same finds in
 * another tool. Newline-separated is the most paste-friendly for scripts
 * and spreadsheet columns alike.
 */
export function CopyFindIdsButton({ ids }: { ids: number[] }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);

  const copy = async () => {
    setError(false);
    try {
      await navigator.clipboard.writeText(ids.join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(true);
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      title="Zkopírovat čísla nálezů (po jednom na řádek)"
      className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 shadow-sm transition hover:bg-amber-50"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden />
      )}
      {copied
        ? "Zkopírováno"
        : error
          ? "Nelze zkopírovat"
          : `Kopírovat ID (${ids.length})`}
    </button>
  );
}
