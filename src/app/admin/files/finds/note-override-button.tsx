"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, StickyNote, X } from "lucide-react";
import {
  setFindNoteOverride,
  type SetNoteOverrideResult,
} from "./note-override-action";

/**
 * Per-find button + modal for the web-display note override. Opens a
 * dialog with a Czech and an optional English variant; saving writes to
 * `data/.admin/find-note-overrides.json` (the filename + LSP JSON are
 * left untouched). The note shows in the banner under the find photo;
 * where no EN variant is set, the EN site falls back to the CS text with
 * a "Czech only" flag.
 */
export function NoteOverrideButton({
  filename,
  initialCs = "",
  initialEn = "",
  hasOverride = false,
}: {
  filename: string;
  initialCs?: string;
  initialEn?: string;
  /** Whether a web override actually exists (drives the chip colour) —
   *  distinct from the pre-filled values, which may just be the raw LSP
   *  note seeded into the fields for convenience. */
  hasOverride?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [cs, setCs] = useState(initialCs);
  const [en, setEn] = useState(initialEn);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Close on Escape while the dialog is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const save = () => {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.append("name", filename);
      fd.append("cs", cs);
      fd.append("en", en);
      try {
        const r: SetNoteOverrideResult = await setFindNoteOverride(fd);
        if (!r.ok) {
          setError(r.error ?? "Uložení selhalo");
          return;
        }
        setOpen(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Uložení selhalo");
      }
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        title="Poznámka pro web (CZ/EN)"
        className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-medium text-[10px] uppercase tracking-wide transition ${
          hasOverride
            ? "bg-sky-100 text-sky-900 hover:bg-sky-200"
            : "bg-gray-100 text-gray-500 hover:bg-gray-200"
        }`}
      >
        <StickyNote className="h-3 w-3" aria-hidden />
        pozn.
      </button>

      {open && (
        // Backdrop: click outside to close (Escape also closes, above).
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-lg bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-start justify-between gap-3">
              <h2 className="text-sm font-semibold text-gray-900">
                Poznámka pro web
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-gray-400 hover:bg-gray-100"
                aria-label="Zavřít"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-3 break-all font-mono text-[11px] text-gray-500">
              {filename}
            </p>
            <p className="mb-3 text-xs text-gray-500">
              Zobrazí se v banneru pod fotkou nálezu. Nezávislé na názvu souboru
              i LSP JSONu (ty se nemění). Předvyplněno aktuální poznámkou; EN je
              podklad z češtiny — přelož ho. Prázdná obě pole = smazat override;
              prázdné EN = v EN se ukáže česky s upozorněním.
            </p>

            <label className="mb-3 block">
              <span className="mb-1 block text-xs font-medium text-gray-700">
                Česky
              </span>
              <textarea
                value={cs}
                onChange={(e) => setCs(e.target.value)}
                rows={3}
                className="w-full rounded border border-gray-300 p-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </label>

            <label className="mb-3 block">
              <span className="mb-1 block text-xs font-medium text-gray-700">
                English (volitelné)
              </span>
              <textarea
                value={en}
                onChange={(e) => setEn(e.target.value)}
                rows={3}
                className="w-full rounded border border-gray-300 p-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </label>

            {error && <p className="mb-2 text-xs text-red-600">{error}</p>}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                Zrušit
              </button>
              <button
                type="button"
                onClick={save}
                disabled={isPending}
                className="inline-flex items-center gap-1 rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-60"
              >
                {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Uložit
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
