"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { HeartOff, Loader2 } from "lucide-react";
import { unmarkFindDonated } from "./unmark-donated-action";

interface Props {
  filename: string;
}

/** Inverse of MarkDonatedButton — single click flips DAROVANY back
 *  to NORMÁLNÍ + note → BezPoznámky and cleans the matching JSON
 *  entries. No confirmation prompt: the operation is reversible by
 *  clicking the donate button again, and the original note text
 *  survives in the audit log + the .trash JSON snapshot if it ever
 *  needs to be recovered. */
export function UnmarkDonatedButton({ filename }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const submit = () => {
    setError(null);
    const fd = new FormData();
    fd.append("name", filename);
    startTransition(async () => {
      const r = await unmarkFindDonated(fd);
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

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={submit}
        disabled={isPending}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-pink-200 bg-white px-2.5 py-1.5 text-xs font-medium text-pink-800 transition hover:border-pink-300 hover:bg-pink-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <HeartOff className="h-3.5 w-3.5" aria-hidden />
        )}
        Zrušit darování
      </button>
      {error && (
        <p className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}
