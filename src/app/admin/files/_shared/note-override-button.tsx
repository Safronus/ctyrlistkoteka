"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, StickyNote, X } from "lucide-react";

/** Minimal shape both the find- and map-note override actions return. */
export interface NoteOverrideResult {
  ok: boolean;
  error?: string;
}

/**
 * Per-file button + modal for a web-display note override (CS + optional
 * EN). Shared by the finds scope (banner under the find photo) and the
 * maps scope (caption under the location map) — the differing bits (which
 * server action to call, the explanatory hint) come in as props.
 *
 * Saving posts the filename + both variants to `action`; the action
 * resolves the id server-side and writes the JSON override store (the
 * filename + DB row are left untouched). Where no EN variant is set, the
 * EN site falls back to the CS text with a "Czech only" flag.
 */
export function NoteOverrideButton({
  filename,
  initialCs = "",
  initialEn = "",
  hasOverride = false,
  action,
  hint,
}: {
  filename: string;
  initialCs?: string;
  initialEn?: string;
  /** Whether a web override actually exists (drives the chip colour) —
   *  distinct from the pre-filled values, which may just be the raw
   *  note/description seeded into the fields for convenience. */
  hasOverride?: boolean;
  /** Server action that persists the override. Both the find- and
   *  map-note actions match this signature. */
  action: (formData: FormData) => Promise<NoteOverrideResult>;
  /** Explanatory paragraph in the modal — scope-specific (where the note
   *  shows, that the filename stays untouched, …). */
  hint: string;
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
        const r = await action(fd);
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop as a real <button> so click-to-close is keyboard-
              operable too (Escape also closes, above); a plain <div onClick>
              trips S1082. It sits behind the panel via -z-10, so panel
              clicks never reach it — no stopPropagation needed. */}
          <button
            type="button"
            aria-label="Zavřít"
            onClick={() => setOpen(false)}
            className="absolute inset-0 -z-10 h-full w-full cursor-default bg-black/40"
          />
          <div className="w-full max-w-lg rounded-lg bg-white p-4 shadow-xl">
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
            <p className="mb-3 text-xs text-gray-500">{hint}</p>

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
