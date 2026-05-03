"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { setFindAnonymized } from "./anonymize-action";

interface Props {
  filename: string;
  /** Parsed pole 5 from the filename. The button flips the opposite
   *  way: NE → ANO with a confirm step (sets site-wide redaction),
   *  ANO → NE in a single click (de-anonymising is reversible). */
  currentlyAnonymized: boolean;
}

/** Toggle on the find detail page that flips segment[4] of the
 *  filename between NE and ANO and patches
 *  `LokaceStavyPoznamky.json → anonymizace.ANONYMIZOVANE` to match.
 *  Site-wide impact: ANO redacts notes/GPS/personal names on the
 *  public Sbírka after the next sync, so the "anonymize" path goes
 *  through a two-step confirm. The "remove" path is a single click —
 *  same UX as the maps anon toggle. */
export function FindAnonymizeToggleButton({
  filename,
  currentlyAnonymized,
}: Props) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const submit = (anonymize: boolean) => {
    setError(null);
    setConfirming(false);
    const fd = new FormData();
    fd.append("name", filename);
    fd.append("anonymize", anonymize ? "1" : "0");
    startTransition(async () => {
      const r = await setFindAnonymized(fd);
      if (!r.ok) {
        setError(r.error ?? "Neznámá chyba");
        return;
      }
      if (r.newFilename) {
        router.push(
          `/admin/files/finds/${encodeURIComponent(r.newFilename)}`,
        );
      } else {
        router.refresh();
      }
    });
  };

  if (currentlyAnonymized) {
    return (
      <div className="inline-flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => submit(false)}
          disabled={isPending}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-emerald-200 bg-white px-2.5 py-1.5 text-xs font-medium text-emerald-800 transition hover:border-emerald-300 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Eye className="h-3.5 w-3.5" aria-hidden />
          )}
          Zrušit anonymizaci
        </button>
        {error && (
          <p className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] text-red-800">
            {error}
          </p>
        )}
      </div>
    );
  }

  if (!confirming) {
    return (
      <div className="inline-flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={isPending}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-violet-200 bg-white px-2.5 py-1.5 text-xs font-medium text-violet-800 transition hover:border-violet-300 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <EyeOff className="h-3.5 w-3.5" aria-hidden />
          Anonymizovat
        </button>
        {error && (
          <p className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] text-red-800">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="inline-flex shrink-0 flex-wrap items-center gap-2 rounded-md border border-violet-300 bg-violet-50 px-2.5 py-1.5 text-xs">
      <span className="text-violet-900">
        Anonymizovat? Skryje GPS, poznámku a jména na veřejném webu.
      </span>
      <button
        type="button"
        onClick={() => submit(true)}
        disabled={isPending}
        className="inline-flex items-center gap-1 rounded bg-violet-600 px-2 py-0.5 font-medium text-white hover:bg-violet-700 disabled:opacity-60"
      >
        {isPending && (
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        )}
        Ano, anonymizovat
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={isPending}
        className="rounded border border-gray-300 bg-white px-2 py-0.5 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
      >
        Zrušit
      </button>
    </div>
  );
}
