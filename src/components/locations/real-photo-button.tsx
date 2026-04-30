"use client";

import { Camera, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * Top-right affordance for the "Mapa lokality" panel that opens a modal
 * pop-up with the real-life photo of the location (with the AOI sketched
 * on top by the author). Native `<dialog>` so focus trap, ESC-to-close
 * and inert background semantics come for free — same pattern as the
 * missing-IDs banner on /sbirka.
 */
export function RealPhotoButton({
  photoUrl,
  caption,
}: {
  photoUrl: string;
  /** Surfaced under the modal image — typically the location code or the
   *  parent map's caption. Helps the visitor confirm which spot they're
   *  looking at when several maps belong to one location. */
  caption: string;
}) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Zobrazit reálnou fotku lokality"
        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
      >
        <Camera className="h-3.5 w-3.5" aria-hidden />
        <span>Reálná fotka</span>
      </button>

      <dialog
        ref={dialogRef}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          // Click on the backdrop (the dialog element itself, not its
          // inner content) closes — children's clicks have a different
          // target and slip past this guard.
          if (e.target === dialogRef.current) setOpen(false);
        }}
        aria-labelledby="real-photo-title"
        className="fixed left-1/2 top-1/2 w-[min(60rem,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-gray-200 bg-white p-0 text-gray-900 shadow-xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2">
          <h2
            id="real-photo-title"
            className="truncate text-sm font-semibold text-gray-900"
            title={caption}
          >
            Reálná fotka — {caption}
          </h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="-m-1 rounded-md p-1 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
            aria-label="Zavřít"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="overflow-auto p-2 max-h-[calc(100vh-6rem)]">
          {/* Plain <img> — Nginx serves /generated/* directly. The intrinsic
              size scales down to the dialog's max-width; users on touch
              devices can pinch-zoom the underlying file in a new tab via
              the "Otevřít originál" link below. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photoUrl}
            alt={`Reálná fotka lokality — ${caption}`}
            className="block h-auto w-full rounded-md"
          />
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-4 py-2 text-xs">
          <a
            href={photoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-brand-700 hover:underline"
          >
            Otevřít originál ↗
          </a>
        </div>
      </dialog>
    </>
  );
}
