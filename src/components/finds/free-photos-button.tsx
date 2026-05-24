"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Images, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { FindFreePhotoEntry } from "@/lib/findFreePhotos";

/**
 * Modal carousel of the "volné" find photos — the second gallery
 * shown next to the donation-photos camera. Simpler than the donation
 * variant: no anonymization, no unlock flow, no placeholder. The
 * button stacks below the donation camera (or sits alone at top-16
 * when the find has no donation photos), matching the right-side
 * control column of `ImageGallery`.
 */
export function FreePhotosButton({
  findId,
  photos,
  stack,
}: {
  findId: number;
  photos: readonly FindFreePhotoEntry[];
  /** Vertical position in the right-side control stack. The camera
   *  (donation modal) sits at `top-16`, so when both buttons mount
   *  this one moves to `top-28`. When only the free gallery exists
   *  it takes the `top-16` slot. */
  stack: "top" | "below-camera";
}) {
  const t = useTranslations("FreePhotos");
  const tCommon = useTranslations("Common");
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (index >= photos.length) setIndex(Math.max(0, photos.length - 1));
  }, [photos.length, index]);

  if (photos.length === 0) return null;
  const current = photos[index];
  const total = photos.length;
  const buttonPosition = stack === "top" ? "top-16" : "top-28";

  const goPrev = () => setIndex((i) => (i - 1 + total) % total);
  const goNext = () => setIndex((i) => (i + 1) % total);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t("openTitle", { total })}
        aria-label={t("openAria", { total })}
        className={`absolute right-3 ${buttonPosition} rounded-full bg-white/90 p-2 text-gray-700 shadow-md ring-1 ring-black/5 backdrop-blur transition hover:bg-white hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500`}
      >
        <Images className="h-5 w-5" />
      </button>

      <dialog
        ref={dialogRef}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === dialogRef.current) setOpen(false);
        }}
        aria-labelledby="free-photos-title"
        className="fixed left-1/2 top-1/2 w-[min(60rem,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-gray-200 bg-white p-0 text-gray-900 shadow-xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2">
          <h2
            id="free-photos-title"
            className="text-sm font-semibold text-gray-900"
          >
            {t("modalTitle", { findId })}
          </h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="-m-1 rounded-md p-1 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
            aria-label={tCommon("close")}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="relative max-h-[calc(100vh-12rem)] overflow-auto bg-gray-50 p-2">
          {current && (
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={current.url}
                alt={t("photoAlt", {
                  findId,
                  slot: current.slot.toUpperCase(),
                })}
                className="mx-auto block h-auto w-full max-w-full rounded-md"
              />

              {total > 1 && (
                <>
                  <button
                    type="button"
                    onClick={goPrev}
                    aria-label={t("prevPhoto")}
                    className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-2 text-gray-700 shadow-md ring-1 ring-black/5 backdrop-blur transition hover:bg-white hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    <ChevronLeft className="h-5 w-5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={goNext}
                    aria-label={t("nextPhoto")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-2 text-gray-700 shadow-md ring-1 ring-black/5 backdrop-blur transition hover:bg-white hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    <ChevronRight className="h-5 w-5" aria-hidden />
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 px-4 py-2 text-xs text-gray-600">
          <div className="flex items-center gap-2">
            {photos.map((p, i) => (
              <button
                key={p.slot}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={t("photoSlot", { slot: p.slot.toUpperCase() })}
                aria-current={i === index}
                className={`inline-flex h-7 w-7 items-center justify-center rounded-md border text-[11px] font-mono uppercase transition ${
                  i === index
                    ? "border-brand-500 bg-brand-50 text-brand-800"
                    : "border-gray-200 bg-white text-gray-600 hover:border-brand-200 hover:text-brand-700"
                }`}
              >
                {p.slot}
              </button>
            ))}
          </div>
          <span className="font-mono tabular-nums">
            {index + 1} / {total}
          </span>
        </div>
      </dialog>
    </>
  );
}
