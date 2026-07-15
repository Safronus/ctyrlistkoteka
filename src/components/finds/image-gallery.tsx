"use client";

import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import type { PublicImage } from "@/lib/queries/finds";
import type { FindPhotoEntry } from "@/lib/findPhotos";
import type { FindFreePhotoEntry } from "@/lib/findFreePhotos";
import { photoDisplay, type PhotoDisplay, type TallRotate } from "@/lib/photoBox";
import { versionedPhotoUrl } from "@/lib/assetVersion";
import { DonationPhotosButton } from "./donation-photos-button";
import { FreePhotosButton } from "./free-photos-button";

/** Per-image CSS for the home showcase's landscape-on-tall flip (photoBox
 *  {@link TallRotate}). Scoped by a unique class so it only touches this one
 *  gallery. The plain rules are the DEFAULT (upright, == current behaviour);
 *  the `@media` block flips the box aspect + the img/crop rotation on
 *  short-but-wide windows. Emitted ONLY when `disp.tallRotate` is set (the
 *  showcase) — the detail page never gets it. */
function tallRotateCss(cls: string, disp: PhotoDisplay, tr: TallRotate): string {
  const upright =
    "position:absolute;inset:0;width:100%;height:100%;max-width:100%;transform:none";
  const rotated =
    "position:absolute;inset:auto;left:50%;top:50%;width:100cqh;height:100cqw;max-width:none;transform:translate(-50%,-50%) rotate(90deg)";
  const defImg = disp.rotated ? rotated : upright;
  const altImg = tr.altRotated ? rotated : upright;
  const defCt = disp.rotated ? "size" : "normal";
  const altCt = tr.altRotated ? "size" : "normal";
  return [
    `.${cls}-box{aspect-ratio:${disp.aspectRatio};container-type:${defCt}}`,
    `.${cls}-main,.${cls}-crop{${defImg}}`,
    `.${cls}-main{object-fit:cover}`,
    `.${cls}-crop{object-fit:contain}`,
    `@media (min-width:${tr.minWidthPx}px) and (max-height:${tr.maxHeightPx}px){` +
      `.${cls}-box{aspect-ratio:${tr.altAspectRatio};container-type:${altCt}}` +
      `.${cls}-main,.${cls}-crop{${altImg}}}`,
  ].join("");
}

/**
 * Renders the find's main photo (ORIGINAL) with an optional zoom button.
 * When a CROP is available, hovering or focusing the magnifier in the
 * top-right swaps the displayed image to the crop. Both images are mounted
 * at once and cross-faded via opacity so the swap is instant.
 *
 * The photo box is sized from the image's own pixel dimensions (see
 * `photoDisplay`): height-capped at 70vh, and landscape originals rotated
 * 90° CW to portrait. The box reserves its space up front so navigating
 * prev/next doesn't jump the page while the new photo streams in. An
 * optional `note` renders as a centered caption banner on the bottom edge,
 * mirroring the location-map caption.
 *
 * The optional Camera button sits directly under the magnifier (top-right
 * stack) and opens the donation-photos modal when the find has any
 * matching files in `${GENERATED_DIR}/find-photos/`. A second "Images"
 * button stacks below it for the "free" photo gallery.
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
  dateSlot = null,
  gpsSlot = null,
  note = null,
  topBanner = null,
  bordered = false,
  goldFrame = false,
  rotateLandscape = false,
  maxVh,
  fill = false,
  landscapeOnTall = false,
  placeholderWidthCss,
  placeholderAspectRatio,
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
  /** Overlay drawn centered on the photo's TOP edge (all sizes) — the find's
   *  state badges. */
  statesSlot?: ReactNode;
  /** Overlay pill drawn in the photo's BOTTOM-LEFT corner — the find's
   *  date/time on the detail page (mirrors the random-clover showcase). */
  dateSlot?: ReactNode;
  /** Overlay pill centered on the photo's BOTTOM edge — the GPS value with
   *  its format toggle on the detail page. Stays interactive. */
  gpsSlot?: ReactNode;
  /** Centered caption banner on the photo's bottom edge (the find note).
   *  Rendered on both the real photo and the placeholder. */
  note?: ReactNode;
  /** Fully-styled banner strip drawn ABOVE the image (state / anonymized
   *  / lost notices). The caller owns its colour + padding; the gallery
   *  just places it at the top of the figure. */
  topBanner?: ReactNode;
  /** Draw a border around the whole figure (like the location map). */
  bordered?: boolean;
  /** Czech-record find: a thicker gold frame instead of the grey border,
   *  matching the gold record banner above the photo. */
  goldFrame?: boolean;
  /** Rotate landscape originals 90° CW so they read as portrait and don't
   *  make the photo (and the location map matched to it) too wide. */
  rotateLandscape?: boolean;
  /** Height cap as a % of viewport height (default 70 — see photoDisplay).
   *  Pass `null` to drop the cap so the photo fills the full column width
   *  (home showcase + "První vs poslední" — a tall portrait then scrolls). */
  maxVh?: number | null;
  /** Fill exactly 100% of the container width (may upscale) so the photo's
   *  edges line up with the container — the home showcase uses this. See
   *  photoDisplay. */
  fill?: boolean;
  /** Home showcase only: flip a full-width tall portrait to landscape on
   *  short-but-wide windows so the whole photo stays visible without shrinking
   *  it off the column edges. Forwarded to photoDisplay; drives the injected
   *  per-image media query. No effect on the detail page (never passed). */
  landscapeOnTall?: boolean;
  /** For the NO_PHOTO placeholder: the width + aspect a real photo would
   *  have occupied, so the placeholder fills the same area (and the map
   *  below still lines up). Defaults to a 16:9 box when omitted. */
  placeholderWidthCss?: string;
  placeholderAspectRatio?: string;
}) {
  const t = useTranslations("ImageGallery");
  const tCommon = useTranslations("Common");
  const [showCrop, setShowCrop] = useState(false);
  // Stable unique scope for the showcase landscape-flip CSS (see below).
  // Sanitised because useId() contains ':' which isn't valid in a selector.
  const galleryId = useId().replace(/[^a-zA-Z0-9]/g, "");

  // The free-photo button stacks below the camera (top-28) when both
  // galleries are present; otherwise it takes the camera's top-16 slot
  // so the visitor always sees a control aligned with the magnifier.
  const freeButtonStack: "top" | "below-camera" =
    donationPhotos.length > 0 ? "below-camera" : "top";

  const borderCls = goldFrame
    ? "border-2 border-amber-300"
    : bordered
      ? "border border-gray-200"
      : "";

  const noteBanner = note ? (
    <figcaption className="whitespace-pre-wrap border-t border-gray-200 bg-white/70 px-3 py-2 text-center text-xs text-gray-700">
      {note}
    </figcaption>
  ) : null;

  if (!image) {
    return (
      <figure
        className={`mx-auto overflow-hidden rounded-xl ${borderCls}`}
        style={
          placeholderWidthCss
            ? { width: placeholderWidthCss, maxWidth: "100%" }
            : undefined
        }
      >
        {topBanner}
        <div
          className={`relative flex items-center justify-center bg-gray-50 ${
            placeholderAspectRatio ? "" : "aspect-video"
          }`}
          style={
            placeholderAspectRatio
              ? { aspectRatio: placeholderAspectRatio }
              : undefined
          }
        >
          {/* Hand-drawn brand clover ("physically here, just no photo") —
              filling ~80% of the placeholder width. Nginx serves the
              static asset (no Next optimizer). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/clover-illustration.png"
            alt=""
            aria-hidden
            className="h-auto w-4/5 max-w-md opacity-90"
          />
          <span className="sr-only">{tCommon("noPhoto")}</span>
          {mapSlot && (
            <div className="absolute left-3 top-3 z-10">{mapSlot}</div>
          )}
          {statesSlot && (
            <div className="absolute left-1/2 top-3 z-10 -translate-x-1/2">
              {statesSlot}
            </div>
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
        {noteBanner}
      </figure>
    );
  }

  // Box geometry from the image's own pixels: height-capped, landscape
  // rotated to portrait, width shared with the location map below.
  const disp = photoDisplay(image.width, image.height, {
    rotate: rotateLandscape,
    maxVh,
    fill,
    landscapeOnTall,
  });
  const filterCls = muted ? "grayscale sepia-[0.12]" : "";
  // Showcase landscape-flip: when photoDisplay hands back `tallRotate`, the
  // box + imgs are driven by an injected, scoped `<style>` (so a media query
  // can flip them) instead of the inline transforms below. `tr` null → the
  // detail page's exact current behaviour.
  const tr = disp?.tallRotate ?? null;
  const rf = tr ? `rf-${galleryId}` : "";

  // Rotated images fill the box via container-query units (100cqh wide,
  // 100cqw tall, then rotated 90° — see photoBox.ts for the geometry);
  // upright images just cover the box (box aspect == image aspect).
  const rotatedImgStyle: CSSProperties = {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: "100cqh",
    height: "100cqw",
    maxWidth: "none",
    transform: "translate(-50%, -50%) rotate(90deg)",
  };
  const mainImgCls = `transition-opacity duration-150 ${
    showCrop && cropImage ? "opacity-0" : "opacity-100"
  } ${filterCls}`;

  return (
    <figure
      className={`photo-figure mx-auto overflow-hidden rounded-xl bg-gray-100 ${borderCls}`}
      style={disp ? { width: disp.widthCss, maxWidth: "100%" } : undefined}
    >
      {topBanner}
      {tr && disp && <style>{tallRotateCss(rf, disp, tr)}</style>}
      <div
        className={`relative ${tr ? `${rf}-box` : ""}`}
        style={
          tr
            ? undefined
            : disp
              ? {
                  aspectRatio: disp.aspectRatio,
                  ...(disp.rotated ? { containerType: "size" } : {}),
                }
              : undefined
        }
      >
        {/* Served by Nginx; Next Image optimizer not needed. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={versionedPhotoUrl(image.webPath)}
          alt={altBase}
          width={image.width}
          height={image.height}
          className={
            tr
              ? `${rf}-main ${mainImgCls}`
              : disp?.rotated
                ? `object-cover ${mainImgCls}`
                : disp
                  ? `absolute inset-0 h-full w-full object-cover ${mainImgCls}`
                  : `block h-auto w-full ${mainImgCls}`
          }
          style={tr ? undefined : disp?.rotated ? rotatedImgStyle : undefined}
        />
        {cropImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={versionedPhotoUrl(cropImage.webPath)}
            alt={t("cropAlt", { base: altBase })}
            aria-hidden={!showCrop}
            className={
              tr
                ? `${rf}-crop pointer-events-none transition-opacity duration-150 ${
                    showCrop ? "opacity-100" : "opacity-0"
                  } ${filterCls}`
                : `pointer-events-none object-contain transition-opacity duration-150 ${
                    disp?.rotated ? "" : "absolute inset-0 h-full w-full"
                  } ${showCrop ? "opacity-100" : "opacity-0"} ${filterCls}`
            }
            style={tr ? undefined : disp?.rotated ? rotatedImgStyle : undefined}
          />
        )}
        {/* Show-on-map pin — top-LEFT overlay. */}
        {mapSlot && <div className="absolute left-3 top-3 z-10">{mapSlot}</div>}
        {/* State badges — centered on the TOP edge at all sizes. (Used to
            drop to the bottom on mobile, but that collided with the
            bottom-left date/GPS overlays.) Drop-shadow keeps the pills
            legible over the photo. */}
        {statesSlot && (
          <div className="absolute left-1/2 top-3 z-10 -translate-x-1/2 drop-shadow-sm">
            {statesSlot}
          </div>
        )}
        {/* Bottom overlays. Narrow photo → date/time over GPS, stacked in the
            bottom-left. Wide enough (container ≥ 50rem, i.e. the two pills can
            coexist without touching) → date/time centred on the photo's bottom
            edge with the GPS pinned bottom-left, on one row. The @container
            query keys off the photo width, not the viewport, so a narrow
            portrait on a wide screen still stacks. */}
        {(dateSlot || gpsSlot) && (
          <div className="@container absolute inset-x-3 bottom-3 z-10">
            <div className="relative flex flex-col items-start gap-1 @min-[50rem]:block @min-[50rem]:h-7">
              {dateSlot && (
                <div className="pointer-events-none @min-[50rem]:absolute @min-[50rem]:inset-x-0 @min-[50rem]:bottom-0 @min-[50rem]:flex @min-[50rem]:justify-center">
                  {dateSlot}
                </div>
              )}
              {gpsSlot && (
                <div className="@min-[50rem]:absolute @min-[50rem]:bottom-0 @min-[50rem]:left-0">
                  {gpsSlot}
                </div>
              )}
            </div>
          </div>
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
                className="rounded-full bg-white/90 p-2 text-brand-700 shadow-md ring-1 ring-black/5 backdrop-blur transition hover:bg-white hover:text-brand-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <Search className="h-5 w-5" />
              </button>
            )}
          </div>
        )}
        {/* Camera button — donation-photo modal. Stacked under the lupa
            (top-16). */}
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
      {noteBanner}
    </figure>
  );
}
