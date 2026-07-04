"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import type { PublicImage } from "@/lib/queries/finds";
import type { FindPhotoEntry } from "@/lib/findPhotos";
import type { FindFreePhotoEntry } from "@/lib/findFreePhotos";
import { DonationPhotosButton } from "./donation-photos-button";
import { FreePhotosButton } from "./free-photos-button";

/**
 * Renders the find's main photo (ORIGINAL) with an optional zoom button.
 * When a CROP is available, hovering or focusing the magnifier in the
 * top-right swaps the displayed image to the crop. Both images are mounted
 * at once and cross-faded via opacity so the swap is instant.
 *
 * The optional Camera button sits directly under the magnifier (top-right
 * stack) and opens the donation-photos modal when the find has any
 * matching files in `${GENERATED_DIR}/find-photos/`. A second "Images"
 * button stacks below it for the "free" photo gallery — extra
 * find-of-the-clover snapshots that don't carry a donation context.
 */
export function ImageGallery({
  image,
  cropImage,
  altBase,
  findId,
  donationPhotos = [],
  freePhotos = [],
  muted = false,
  mapSlot = null,
  voteSlot = null,
  statesSlot = null,
}: {
  image: PublicImage | null;
  cropImage: PublicImage | null;
  altBase: string;
  /** Find ID — required when either gallery is non-empty so the modals
   *  can render with the right context. */
  findId?: number;
  /** Photos for the donation modal. Empty array (default) hides the
   *  Camera button. */
  donationPhotos?: readonly FindPhotoEntry[];
  /** Photos for the free-photos modal. Empty array (default) hides the
   *  second (Images) button. */
  freePhotos?: readonly FindFreePhotoEntry[];
  /** Lost-find treatment: renders the photos desaturated with a faint
   *  warm tint ("it lives on only in the photo"). The filter goes on
   *  the <img> elements only — putting it on the wrapper would create
   *  a containing block and trap the fixed-position photo modals. */
  muted?: boolean;
  /** Overlay drawn in the photo's top-LEFT corner (the "show on map"
   *  pin). Rendered on both the real photo and the no-photo placeholder
   *  when provided. */
  mapSlot?: ReactNode;
  /** Overlay drawn in the photo's top-RIGHT corner, to the left of the
   *  crop magnifier (the vote button). Only shown on the real photo. */
  voteSlot?: ReactNode;
  /** Overlay drawn in the photo's bottom-LEFT corner (the find's state
   *  badges). Rendered on both the real photo and the placeholder. */
  statesSlot?: ReactNode;
}) {
  const t = useTranslations("ImageGallery");
  const tCommon = useTranslations("Common");
  const [showCrop, setShowCrop] = useState(false);

  // The free-photo button stacks below the camera (top-28) when both
  // galleries are present; otherwise it takes the camera's top-16 slot
  // so the visitor always sees a control aligned with the magnifier.
  const freeButtonStack: "top" | "below-camera" =
    donationPhotos.length > 0 ? "below-camera" : "top";

  if (!image) {
    return (
      <div className="relative flex aspect-video items-center justify-center rounded-xl bg-gradient-to-br from-brand-50 to-brand-100">
        <span aria-hidden className="text-4xl opacity-40">
          🍀
        </span>
        <span className="sr-only">{tCommon("noPhoto")}</span>
        {mapSlot && <div className="absolute left-3 top-3 z-10">{mapSlot}</div>}
        {statesSlot && (
          <div className="absolute bottom-3 left-3 z-10">{statesSlot}</div>
        )}
        {/* No main photo doesn't preclude attached galleries (e.g.
            NO_PHOTO state but the recipient still got a card, or the
            author shot the spot itself). Both buttons still mount so
            the visitor can browse what's there. */}
        {donationPhotos.length > 0 && findId !== undefined && (
          <DonationPhotosButton findId={findId} photos={donationPhotos} />
        )}
        {freePhotos.length > 0 && findId !== undefined && (
          <FreePhotosButton
            findId={findId}
            photos={freePhotos}
            stack={freeButtonStack}
          />
        )}
      </div>
    );
  }

  return (
    // Shrink-wrap the photo (centred) rather than stretching it to full
    // width with letterbox fill — so the lupa / overlay buttons land on
    // the photo's real top corners and any bottom strip spans the photo
    // width. The width/height attrs reserve the aspect ratio up front so
    // the height-capped box doesn't cause a layout shift on image load.
    <div className="relative mx-auto w-fit max-w-full overflow-hidden rounded-xl bg-gray-100">
      {/* Served by Nginx; Next Image optimizer not needed. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.webPath}
        alt={altBase}
        width={image.width}
        height={image.height}
        className={`block max-h-[70vh] w-auto max-w-full transition-opacity duration-150 ${
          showCrop && cropImage ? "opacity-0" : "opacity-100"
        } ${muted ? "grayscale sepia-[0.12]" : ""}`}
      />
      {/* Show-on-map pin — top-LEFT overlay. */}
      {mapSlot && <div className="absolute left-3 top-3 z-10">{mapSlot}</div>}
      {/* State badges — bottom-LEFT overlay. Drop-shadow keeps the small
          coloured pills legible over a busy photo. */}
      {statesSlot && (
        <div className="absolute bottom-3 left-3 z-10 drop-shadow-sm">
          {statesSlot}
        </div>
      )}
      {cropImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={cropImage.webPath}
          alt={t("cropAlt", { base: altBase })}
          aria-hidden={!showCrop}
          className={`pointer-events-none absolute inset-0 h-full w-full object-contain transition-opacity duration-150 ${
            showCrop ? "opacity-100" : "opacity-0"
          } ${muted ? "grayscale sepia-[0.12]" : ""}`}
        />
      )}
      {/* Top-RIGHT control cluster: the vote button sits to the LEFT of
          the crop magnifier, both the same height. Either can be absent
          (no photo-vote surface / no crop) and the row still lines up. */}
      {(voteSlot || cropImage) && (
        <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
          {voteSlot}
          {cropImage && (
            <button
              type="button"
              onMouseEnter={() => setShowCrop(true)}
              onMouseLeave={() => setShowCrop(false)}
              onFocus={() => setShowCrop(true)}
              onBlur={() => setShowCrop(false)}
              aria-label={t("showCrop")}
              aria-pressed={showCrop}
              title={t("showCrop")}
              className="rounded-full bg-white/90 p-2 text-gray-700 shadow-md ring-1 ring-black/5 backdrop-blur transition hover:bg-white hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <Search className="h-5 w-5" />
            </button>
          )}
        </div>
      )}
      {/* Camera button — donation-photo modal. Stacked under the lupa
          (top-16) so the two affordances read as a vertical control
          column. Renders only when the find has matching files in
          `${GENERATED_DIR}/find-photos/` AND a findId was passed. */}
      {donationPhotos.length > 0 && findId !== undefined && (
        <DonationPhotosButton findId={findId} photos={donationPhotos} />
      )}
      {/* Images button — free-photo modal. Sits below the camera when
          both galleries exist, otherwise takes the camera's slot. */}
      {freePhotos.length > 0 && findId !== undefined && (
        <FreePhotosButton
          findId={findId}
          photos={freePhotos}
          stack={freeButtonStack}
        />
      )}
    </div>
  );
}
