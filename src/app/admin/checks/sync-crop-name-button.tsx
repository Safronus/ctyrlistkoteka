"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Loader2 } from "lucide-react";
import { renameCrop } from "@/app/admin/files/crops/rename-action";

interface Props {
  /** Original's filename on disk (lives in data/finds/). Source of
   *  truth for the stem — we copy that across to the crop. */
  originalFilename: string;
  /** Crop's current filename on disk (lives in data/crops/). The
   *  crop's own extension is preserved — the original is often a
   *  .HEIC while the crop is a .JPG/.WEBP, and the rename should
   *  not change that. */
  cropFilename: string;
}

/** Splits a filename into (stem, extension-with-dot). Matches the
 *  helper in _shared/rename-button.tsx; inline here so the client
 *  bundle doesn't pull in the rename-button module just for two
 *  lines of logic. */
function splitExt(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf(".");
  if (dot === -1) return { stem: name, ext: "" };
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

/** Per-row action on the "Originál a ořez se v názvu liší" check.
 *  Click → server-side rename of the crop to `<original-stem>.<crop-
 *  ext>`. Extension stays intact because the two files are usually
 *  in different formats (HEIC original, JPG/WEBP crop), and the
 *  matter at hand is the stem, not the extension.
 *
 *  Reuses the existing renameCrop server action — same validation
 *  (parseFindFilename OR short-form regex), same audit log entry,
 *  same atomic fs.rename. Just driven from here instead of the
 *  detail-page popover.
 *
 *  On success: router.refresh() so the check re-runs and the row
 *  disappears from the next render. */
export function SyncCropNameButton({ originalFilename, cropFilename }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const submit = () => {
    setError(null);
    const { stem: originalStem } = splitExt(originalFilename);
    const { ext: cropExt } = splitExt(cropFilename);
    const newCropName = originalStem + cropExt;
    if (newCropName === cropFilename) {
      // Should never happen (the check filtered names that already
      // match), but defensive guard avoids a 400 round-trip when
      // it does.
      return;
    }
    const fd = new FormData();
    fd.append("oldName", cropFilename);
    fd.append("newName", newCropName);
    startTransition(async () => {
      const r = await renameCrop(fd);
      if (!r.ok) {
        setError(r.error ?? "Přejmenování ořezu selhalo");
        return;
      }
      // The check page is force-dynamic, so refresh() re-runs the
      // server component and the offender row drops out — no
      // optimistic-update logic needed on the client.
      router.refresh();
    });
  };

  return (
    <div className="inline-flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={submit}
        disabled={isPending}
        title={`Přejmenovat ořez na "${
          splitExt(originalFilename).stem + splitExt(cropFilename).ext
        }"`}
        className="inline-flex items-center gap-1 rounded-md border border-brand-300 bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-800 transition hover:border-brand-400 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? (
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        ) : (
          <ArrowLeftRight className="h-3 w-3" aria-hidden />
        )}
        Sjednotit ořez s originálem
      </button>
      {error && (
        <span
          className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] text-red-800"
          title={error}
        >
          {error.length > 32 ? `${error.slice(0, 32)}…` : error}
        </span>
      )}
    </div>
  );
}
