"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import type { PublicImage } from "@/lib/queries/finds";
import type { FindPhotoEntry } from "@/lib/findPhotos";
import { DonationPhotosButton } from "./donation-photos-button";

/**
 * Renders the find's main photo (ORIGINAL) with an optional zoom button.
 * When a CROP is available, hovering or focusing the magnifier in the
 * top-right swaps the displayed image to the crop. Both images are mounted
 * at once and cross-faded via opacity so the swap is instant.
 *
 * The optional Camera button sits directly under the magnifier (top-right
 * stack) and opens the donation-photos modal when the find has any
 * matching files in `${GENERATED_DIR}/find-photos/`.
 */
export function ImageGallery({
  image,
  cropImage,
  altBase,
  findId,
  donationPhotos = [],
}: {
  image: PublicImage | null;
  cropImage: PublicImage | null;
  altBase: string;
  /** Find ID — only required when `donationPhotos` is non-empty so the
   *  modal can post the unlock action with the right key. Callers that
   *  don't surface donation photos (e.g. the home-page random-find
   *  showcase) can omit it. */
  findId?: number;
  /** Photos for the donation modal. Empty array (default) hides the
   *  Camera button. */
  donationPhotos?: readonly FindPhotoEntry[];
}) {
  const [showCrop, setShowCrop] = useState(false);

  if (!image) {
    return (
      <div className="relative flex aspect-video items-center justify-center rounded-xl bg-gradient-to-br from-brand-50 to-brand-100">
        <span aria-hidden className="text-4xl opacity-40">
          🍀
        </span>
        <span className="sr-only">Žádná fotografie</span>
        {/* No main photo doesn't preclude donation photos (e.g.
            NO_PHOTO state but the recipient still got a card). The
            button still mounts so visitors with the unlock code can
            see the artwork. */}
        {donationPhotos.length > 0 && findId !== undefined && (
          <DonationPhotosButton
            findId={findId}
            photos={donationPhotos}
          />
        )}
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-xl bg-gray-100">
      {/* Served by Nginx; Next Image optimizer not needed. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.webPath}
        alt={altBase}
        className={`max-h-[70vh] w-full object-contain transition-opacity duration-150 ${
          showCrop && cropImage ? "opacity-0" : "opacity-100"
        }`}
      />
      {cropImage && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cropImage.webPath}
            alt={`${altBase} – výřez`}
            aria-hidden={!showCrop}
            className={`pointer-events-none absolute inset-0 h-full w-full object-contain transition-opacity duration-150 ${
              showCrop ? "opacity-100" : "opacity-0"
            }`}
          />
          <button
            type="button"
            onMouseEnter={() => setShowCrop(true)}
            onMouseLeave={() => setShowCrop(false)}
            onFocus={() => setShowCrop(true)}
            onBlur={() => setShowCrop(false)}
            aria-label="Zobrazit výřez"
            aria-pressed={showCrop}
            title="Zobrazit výřez"
            className="absolute right-3 top-3 rounded-full bg-white/90 p-2 text-gray-700 shadow-md ring-1 ring-black/5 backdrop-blur transition hover:bg-white hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <Search className="h-5 w-5" />
          </button>
        </>
      )}
      {/* Camera button — donation-photo modal. Stacked under the lupa
          (top-16) so the two affordances read as a vertical control
          column. Renders only when the find has matching files in
          `${GENERATED_DIR}/find-photos/` AND a findId was passed. */}
      {donationPhotos.length > 0 && findId !== undefined && (
        <DonationPhotosButton findId={findId} photos={donationPhotos} />
      )}
    </div>
  );
}
