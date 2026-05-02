"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Pencil, Loader2, X, XCircle } from "lucide-react";
import { renameMapDescription } from "./rename-action";

interface Props {
  filename: string;
  /** Current description (segment[1] of the basename, NFC-normalised). */
  currentDescription: string;
}

/** Inline editor for the human-readable description in a location-map
 *  filename — the segment between the first and second `+`. The
 *  rename rebuilds the basename and moves the file; we don't display
 *  the new name pre-emptively because the user is editing one
 *  segment, not the whole filename. */
export function MapDescriptionEditor({
  filename,
  currentDescription,
}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(currentDescription);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const onCancel = () => {
    setEditing(false);
    setDraft(currentDescription);
    setError(null);
  };

  const onSave = () => {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.append("name", filename);
      fd.append("description", draft);
      try {
        const r = await renameMapDescription(fd);
        if (!r.ok) {
          setError(r.error ?? "Editace popisku selhala");
          return;
        }
        // The rename changes the on-disk basename. Push to the new
        // detail URL so the breadcrumb + delete buttons reflect it.
        if (r.filename !== filename) {
          router.push(
            `/admin/files/maps/${encodeURIComponent(r.filename)}`,
          );
        } else {
          router.refresh();
        }
        setEditing(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Editace selhala");
      }
    });
  };

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white p-3 text-sm">
        <span className="text-xs uppercase tracking-wide text-gray-500">
          Popisek
        </span>
        <span
          className="min-w-0 flex-1 break-words font-mono text-gray-900"
          title={currentDescription}
        >
          {currentDescription || "—"}
        </span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-brand-300 bg-white px-2.5 py-1 text-xs font-medium text-brand-800 transition hover:border-brand-400 hover:bg-brand-50"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
          Upravit popisek
        </button>
      </div>
    );
  }

  const draftError =
    draft.includes("+")
      ? "Popisek nesmí obsahovat '+'."
      : draft.includes("/") || draft.includes("\\")
        ? "Popisek nesmí obsahovat lomítka."
        : draft.trim().length === 0
          ? "Popisek nesmí být prázdný."
          : null;

  return (
    <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/40 p-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-amber-900">
          Popisek
        </span>
        <input
          autoFocus
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={isPending}
          className="block flex-1 rounded-md border border-amber-300 bg-white px-2 py-1 font-mono text-sm shadow-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !draftError) onSave();
            if (e.key === "Escape") onCancel();
          }}
        />
        <button
          type="button"
          onClick={onSave}
          disabled={isPending || draftError !== null}
          className="inline-flex shrink-0 items-center gap-1 rounded bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
          )}
          Uložit
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          aria-label="Zrušit"
          className="shrink-0 rounded border border-gray-300 bg-white p-1 text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <p className="text-[11px] text-gray-600">
        Editor přepíše druhý <code className="font-mono">+</code>-segment
        názvu. Zbytek (location code, GPS, zoom, MAP_ID, přípona) zůstává
        beze změny. Soubor se přejmenuje atomicky.
      </p>
      {(draftError || error) && (
        <p className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-800">
          <XCircle className="h-3.5 w-3.5" aria-hidden />
          {draftError ?? error}
        </p>
      )}
    </div>
  );
}
