"use client";

import { useState } from "react";
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
  framed = false,
}: {
  image: PublicImage | null;
  cropImage: PublicImage | null;
  altBase: string;
  /** Draw a thin border around the photo box. The find-detail page
   *  passes this so the centred, shrink-wrapped photo reads as a framed
   *  panel; the home-page widget leaves it off because its own section
   *  card already provides the frame. */
  framed?: boolean;
  /** Find ID — required when either gallery is non-empty so the modals
   *  can render with the right context. */
  findId?: number;
  /** Photos for the donation modal. Empty array (default) hides the
   *  Camera button. */
  donationPhotos?: readonly FindPhotoEntry[];
  /** Photos for the free-photos modal. Empty array (default) hides the
   *  second (Images) button. */
  freePhotos?: readonly FindFreePhotoEntry[];
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
      <div
        className={`relative flex aspect-video items-center justify-center rounded-xl bg-gradient-to-br from-brand-50 to-brand-100 ${
          framed ? "border border-gray-200" : ""
        }`}
      >
        <span aria-hidden className="text-4xl opacity-40">
          🍀
        </span>
        <span className="sr-only">{tCommon("noPhoto")}</span>
        {/* No main photo doesn't preclude attached galleries (e.g.
            NO_PHOTO state but the recipient still got a card, or the
            author shot the spot itself). Both buttons still mount so
            the visitor can browse what's there. */}
        {donationPhotos.length > 0 && findId !== undefined && (
          <DonationPhotosButton
            findId={findId}
            photos={donationPhotos}
          />
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
    <div
      className={`relative mx-auto w-fit max-w-full overflow-hidden rounded-xl bg-gray-100 ${
        framed ? "border border-gray-200" : ""
      }`}
    >
      {/* Served by Nginx; Next Image optimizer not needed. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.webPath}
        alt={altBase}
        width={image.width}
        height={image.height}
        className={`block max-h-[70vh] w-auto max-w-full transition-opacity duration-150 ${
          showCrop && cropImage ? "opacity-0" : "opacity-100"
        }`}
      />
      {cropImage && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cropImage.webPath}
            alt={t("cropAlt", { base: altBase })}
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
            aria-label={t("showCrop")}
            aria-pressed={showCrop}
            title={t("showCrop")}
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
