"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Loader2 } from "lucide-react";
import { syncCropNameToOriginal } from "./sync-crop-name-action";

interface Props {
  /** Find ID — the server uses it as the lookup key to find BOTH
   *  the current original filename and the current crop filename
   *  fresh from disk at action time. This sidesteps the staleness
   *  bug from the previous round: when the operator manually
   *  renamed the original in its detail page (fixing case in a
   *  diacritic, for example) and then clicked sync here without
   *  refreshing the check, the client had the OLD original name
   *  baked into the row props and the server faithfully renamed
   *  the crop to match the OLD name — undoing the fix. Reading
   *  both sides on the server eliminates the race entirely. */
  findId: number;
}

/** One-click action that renames the find's crop on disk so its
 *  basename equals the original's basename, while keeping the
 *  crop's own extension (a .JPG crop stays a .JPG even if the
 *  original is .HEIC). The server reads both filenames fresh
 *  from disk — no client-supplied filenames are trusted. */
export function SyncCropNameButton({ findId }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const submit = () => {
    setError(null);
    const fd = new FormData();
    fd.append("findId", String(findId));
    startTransition(async () => {
      try {
        const r = await syncCropNameToOriginal(fd);
        if (!r.ok) {
          setError(r.error ?? "Přejmenování ořezu selhalo");
          return;
        }
        // Check page is force-dynamic, so refresh() re-runs the
        // server component and the (now-resolved) row drops out.
        router.refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[sync-crop-name] action threw", err);
        setError(`Akce selhala: ${message}`);
      }
    });
  };

  return (
    <div className="inline-flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={submit}
        disabled={isPending}
        title="Přejmenovat ořez tak, aby měl stejný název (bez přípony) jako originál"
        className="inline-flex items-center gap-1 rounded-md border border-brand-300 bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-800 transition hover:border-brand-400 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? (
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        ) : (
          <ArrowLeftRight className="h-3 w-3" aria-hidden />
        )}
        Přejmenovat ořez dle originálu
      </button>
      {error && (
        <span
          className="block max-w-[24rem] break-all rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] text-red-800"
          title={error}
        >
          {error}
        </span>
      )}
    </div>
  );
}
