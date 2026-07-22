"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Camera, ChevronLeft, ChevronRight, Gift, Lock, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { FindPhotoEntry } from "@/lib/findPhotos";
import { unlockFindPhotos } from "@/lib/actions/findPhotoUnlock";
import { FIND_PHOTO_UNLOCK_INITIAL } from "@/lib/actions/findPhotoUnlockTypes";

/**
 * Modal carousel of donation photos for a find. Renders as a small
 * Camera button; clicking it opens a native `<dialog>` with one photo
 * at a time and prev / next chips. Photos arrive sorted by slot (a, b,
 * c …) so the front of a card consistently lands first.
 *
 * ANON entries arrive with `url: null`. Until the visitor types the
 * unlock code, those slots render a "?" placeholder mirroring the
 * anonymized location-map overlay on /sbirka/[id]. The form posts to a
 * server action that verifies the global secret and returns base64
 * data URLs for every ANON photo of this find. Unlocked URLs live in
 * local state — refresh re-locks them.
 */
export function DonationPhotosButton({
  findId,
  photos,
}: {
  findId: number;
  photos: readonly FindPhotoEntry[];
}) {
  const t = useTranslations("DonationPhotos");
  const tCommon = useTranslations("Common");
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, action, isPending] = useActionState(
    unlockFindPhotos,
    FIND_PHOTO_UNLOCK_INITIAL,
  );
  // Unlocked data URLs by slot — populated after a successful action.
  // We don't lift these into state when the modal opens; the action
  // result IS the source of truth.
  const unlocked = new Map(
    state.status === "ok"
      ? state.photos.map((p) => [p.slot, p.dataUrl] as const)
      : [],
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Reset index when the photo set changes (e.g., the visitor opens
  // the modal for a different find within the same SPA navigation).
  // Capping at length-1 also handles the rare case where photos shrink.
  useEffect(() => {
    if (index >= photos.length) setIndex(Math.max(0, photos.length - 1));
  }, [photos.length, index]);

  if (photos.length === 0) return null;
  const current = photos[index];
  const total = photos.length;
  const hasAnon = photos.some((p) => p.isAnonymized);
  // Resolve the displayable image URL for the current slot:
  //   - public photo → its `url`
  //   - anon, locked → null (placeholder renders)
  //   - anon, unlocked → data URL from the action result
  const displaySrc = current
    ? current.isAnonymized
      ? (unlocked.get(current.slot) ?? null)
      : current.url
    : null;

  const goPrev = () => setIndex((i) => (i - 1 + total) % total);
  const goNext = () => setIndex((i) => (i + 1) % total);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t("openTitle", { total })}
        aria-label={t("openAria", { total })}
        // The Camera sits at full size with a small Gift badge anchored
        // to the lower-right corner — combo cue that this gallery is
        // specifically for donation photos (vs the plain `Images` button
        // below for the generic free-photo gallery). The Gift is a solid
        // brand-red pip with a white ring — a crisp notification-style
        // badge that reads as a distinct shape against the camera outline.
        className="absolute right-3 top-16 rounded-full bg-white/90 p-2 text-gray-700 shadow-md ring-1 ring-black/5 backdrop-blur transition hover:bg-white hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
      >
        <span className="relative inline-flex">
          <Camera className="h-5 w-5" aria-hidden />
          <span
            aria-hidden
            className="absolute -bottom-1.5 -right-1.5 inline-flex items-center justify-center rounded-full bg-brand-600 p-[3px] text-white shadow-sm ring-2 ring-white"
          >
            <Gift className="h-2.5 w-2.5" />
          </span>
        </span>
      </button>

      <dialog
        ref={dialogRef}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === dialogRef.current) setOpen(false);
        }}
        aria-labelledby="donation-photos-title"
        className="fixed left-1/2 top-1/2 w-[min(60rem,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-gray-200 bg-white p-0 text-gray-900 shadow-xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2">
          <h2
            id="donation-photos-title"
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

        <div className="relative max-h-[calc(100dvh-11rem)] overflow-auto bg-gray-50 p-2">
          {current && (
            <div className="relative">
              {displaySrc ? (
                /* Public photo or unlocked ANON — render the image. Bounded
                   by the viewport HEIGHT (not width) so a tall portrait
                   donation photo fits fully on screen instead of overflowing
                   into a scroll. dvh tracks the real height under mobile
                   browser chrome. */
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={displaySrc}
                  alt={t("photoAlt", {
                    findId,
                    slot: current.slot.toUpperCase(),
                  })}
                  className="mx-auto block h-auto max-h-[calc(100dvh-13rem)] w-auto max-w-full rounded-md"
                />
              ) : (
                <AnonymizedPlaceholder slot={current.slot} />
              )}

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

        {hasAnon && state.status !== "ok" && (
          <form
            action={action}
            className="flex flex-wrap items-center gap-2 border-t border-gray-200 bg-amber-50/60 px-4 py-2 text-xs"
          >
            <input type="hidden" name="findId" value={findId} />
            <Lock className="h-4 w-4 text-amber-700" aria-hidden />
            <label className="font-medium text-amber-900">
              {t("anonLabel")}
            </label>
            <input
              type="password"
              name="code"
              autoComplete="off"
              spellCheck={false}
              className="h-7 flex-1 min-w-[8rem] rounded border border-amber-300 bg-white px-2 font-mono text-xs text-gray-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
              placeholder="••••••"
            />
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex h-7 items-center gap-1 rounded-md bg-amber-600 px-3 text-xs font-medium text-white shadow-sm transition hover:bg-amber-700 disabled:opacity-60"
            >
              {isPending ? t("verifying") : t("unlock")}
            </button>
            {state.status === "invalid" && (
              <span className="basis-full text-amber-900">
                {t("invalidCode")}
              </span>
            )}
            {state.status === "missing-config" && (
              <span className="basis-full text-amber-900">
                {t.rich("missingConfig", {
                  code: (chunks) => <code>{chunks}</code>,
                })}
              </span>
            )}
            {state.status === "error" && (
              <span className="basis-full text-amber-900">
                {t("genericError")}
              </span>
            )}
          </form>
        )}
        {hasAnon && state.status === "ok" && (
          <p className="border-t border-gray-200 bg-emerald-50 px-4 py-1.5 text-xs text-emerald-900">
            {t("unlockSuccess")}
          </p>
        )}
      </dialog>
    </>
  );
}

function AnonymizedPlaceholder({ slot }: { slot: string }) {
  const t = useTranslations("DonationPhotos");
  return (
    <div
      role="img"
      aria-label={t("placeholderAria")}
      className="mx-auto flex aspect-[3/4] max-h-[calc(100dvh-13rem)] w-full max-w-[22rem] items-center justify-center rounded-md bg-gradient-to-br from-purple-100 to-purple-200"
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <span
          aria-hidden
          className="select-none text-7xl font-black text-purple-900/80 drop-shadow-sm"
        >
          ?
        </span>
        <span className="select-none rounded-full bg-purple-50/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-purple-900 shadow-sm">
          {t("placeholderSlot", { slot: slot.toUpperCase() })}
        </span>
        <span className="text-[11px] text-purple-900/80">
          {t("placeholderHint")}
        </span>
      </div>
    </div>
  );
}
