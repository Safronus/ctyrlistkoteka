"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Heart, Loader2 } from "lucide-react";
import { markFindDonated } from "./mark-donated-action";

interface Props {
  filename: string;
}

/** Two-step "mark donated" control on the find detail page. The
 *  state token in the filename (`segment[3]`) flips to DAROVANY and
 *  the note segment (everything past the 5th `+`) is rewritten to
 *  the user-supplied text. The action also patches
 *  LokaceStavyPoznamky.json (DAROVANY range + poznamky[id]) so the
 *  next sync writes findStateAssignment + Find.notes — filenames are
 *  signal, JSON is the DB source of truth (filename-convention.md). */
export function MarkDonatedButton({ filename }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => {
          setConfirming(true);
          setError(null);
        }}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-pink-200 bg-white px-2.5 py-1.5 text-xs font-medium text-pink-800 transition hover:border-pink-300 hover:bg-pink-50"
      >
        <Heart className="h-3.5 w-3.5" aria-hidden />
        Označit jako darovaný
      </button>
    );
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmed = note.trim();
    if (trimmed.length === 0) {
      setError("Poznámka je povinná.");
      return;
    }
    const fd = new FormData();
    fd.append("name", filename);
    fd.append("note", trimmed);
    startTransition(async () => {
      const r = await markFindDonated(fd);
      if (!r.ok) {
        setError(r.error ?? "Neznámá chyba");
        return;
      }
      // Filename has changed — navigate to the new path so the URL
      // doesn't 404 on the now-missing original.
      if (r.newFilename) {
        router.push(
          `/admin/files/finds/${encodeURIComponent(r.newFilename)}`,
        );
      } else {
        router.refresh();
      }
    });
  };

  return (
    <form
      onSubmit={submit}
      className="inline-flex shrink-0 flex-wrap items-center gap-2 rounded-md border border-pink-300 bg-pink-50 px-2.5 py-1.5 text-xs"
    >
      <label className="inline-flex items-center gap-1.5">
        <span className="text-pink-900">Poznámka:</span>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          autoFocus
          required
          disabled={isPending}
          placeholder="komu / kdy / proč"
          className="w-72 rounded border border-pink-300 bg-white px-1.5 py-0.5 font-mono text-xs text-gray-900 focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500 disabled:opacity-60"
        />
      </label>
      <button
        type="submit"
        disabled={isPending}
        className="inline-flex items-center gap-1 rounded bg-pink-600 px-2 py-0.5 font-medium text-white hover:bg-pink-700 disabled:opacity-60"
      >
        {isPending && (
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        )}
        Označit jako darovaný
      </button>
      <button
        type="button"
        onClick={() => {
          setConfirming(false);
          setNote("");
          setError(null);
        }}
        disabled={isPending}
        className="rounded border border-gray-300 bg-white px-2 py-0.5 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
      >
        Zrušit
      </button>
      {error && (
        <p className="basis-full rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] text-red-800">
          {error}
        </p>
      )}
    </form>
  );
}
