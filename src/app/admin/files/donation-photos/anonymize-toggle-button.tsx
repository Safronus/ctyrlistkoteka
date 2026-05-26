"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { setDonationPhotoAnonymized } from "./anonymize-action";

interface Props {
  filename: string;
  /** Parsed `_ANON` token presence in the filename. The button flips
   *  the opposite way: `_DAR.` → `_DAR_ANON.` (Nginx blocks the new
   *  filename so the photo only renders after the unlock code) or
   *  the inverse. Single click both ways — the action only touches
   *  one photo and the file stays on disk regardless. */
  currentlyAnonymized: boolean;
}

/** Toggle on the donation-photo detail page that flips the `_ANON`
 *  suffix on the filename. Single-click both directions: simpler
 *  surface than the find/map anonymize toggles because there's no
 *  paired file to also rename and no JSON to keep in lockstep.
 *  After a successful rename the action returns the new filename
 *  and the button redirects so the URL stays valid. */
export function DonationPhotoAnonymizeToggleButton({
  filename,
  currentlyAnonymized,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const submit = (anonymize: boolean) => {
    setError(null);
    const fd = new FormData();
    fd.append("name", filename);
    fd.append("anonymize", anonymize ? "1" : "0");
    startTransition(async () => {
      const r = await setDonationPhotoAnonymized(fd);
      if (!r.ok) {
        setError(r.error ?? "Neznámá chyba");
        return;
      }
      if (r.newFilename) {
        // Filename change ⇒ URL change. Redirect to the new detail
        // page so the user lands on a valid URL instead of a 404.
        router.push(
          `/admin/files/donation-photos/${encodeURIComponent(r.newFilename)}`,
        );
      } else {
        router.refresh();
      }
    });
  };

  return (
    <div className="inline-flex flex-col items-end gap-1">
      {currentlyAnonymized ? (
        <button
          type="button"
          onClick={() => submit(false)}
          disabled={isPending}
          title="Odebrat _ANON ze jména → fotka půjde veřejně bez kódu"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-emerald-200 bg-white px-2.5 py-1.5 text-xs font-medium text-emerald-800 transition hover:border-emerald-300 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Eye className="h-3.5 w-3.5" aria-hidden />
          )}
          Zrušit anonymizaci
        </button>
      ) : (
        <button
          type="button"
          onClick={() => submit(true)}
          disabled={isPending}
          title="Přidat _ANON do jména → Nginx 404s, návštěvník musí zadat kód"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-violet-200 bg-white px-2.5 py-1.5 text-xs font-medium text-violet-800 transition hover:border-violet-300 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <EyeOff className="h-3.5 w-3.5" aria-hidden />
          )}
          Anonymizovat
        </button>
      )}
      {error && (
        <p className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}
