import { ImageType } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import type { PublicImage } from "@/lib/queries/finds";

/**
 * Renders the primary image for a find. Falls back to a CSS placeholder
 * when no image is available (seed data or NO_PHOTO finds). A plain <img>
 * is used — images are served statically by Nginx in production (see
 * docs/architecture.md).
 *
 * When a `cropImage` is passed, it's layered on top and revealed on hover
 * over the photo (desktop) — a peek at the clover close-up (the same CROP
 * the detail page shows) without leaving the grid. Pure CSS, no client JS,
 * and the click target is unchanged (the parent stays the link to detail).
 */

/** The CROP close-up of a find (for the /sbirka hover reveal), or null when
 *  the find has no distinct crop image. */
export function cropVariant(
  primary: PublicImage | null,
  images: PublicImage[],
): PublicImage | null {
  const crop = images.find((i) => i.imageType === ImageType.CROP) ?? null;
  return crop && crop.id !== primary?.id ? crop : null;
}

export async function FindThumbnail({
  image,
  cropImage = null,
  alt,
  className = "",
  sizeHint = "thumb",
  priority = false,
}: {
  image: PublicImage | null;
  /** CROP variant revealed on hover over the photo (desktop). Omit to keep a
   *  static thumbnail (e.g. the detail-page showcase has its own magnifier). */
  cropImage?: PublicImage | null;
  alt: string;
  className?: string;
  sizeHint?: "thumb" | "web";
  /** Above-the-fold thumbnails (first grid row / list rows) set this so
   *  the image loads eagerly with high fetch priority — a lazily loaded
   *  LCP element is what PageSpeed flagged on /sbirka (LCP 3.7 s even on
   *  desktop). Off-screen thumbnails stay lazy. */
  priority?: boolean;
}) {
  const baseClasses =
    "group/thumb relative overflow-hidden bg-gradient-to-br " +
    "from-brand-50 to-brand-100 " +
    className;

  if (!image) {
    const tCommon = await getTranslations("Common");
    return (
      <div className={baseClasses} aria-label={tCommon("noPhoto")}>
        <div
          aria-hidden
          className="absolute inset-0 flex items-center justify-center text-3xl opacity-40"
        >
          🍀
        </div>
      </div>
    );
  }

  const src = sizeHint === "web" ? image.webPath : image.thumbPath;
  const cropSrc = cropImage
    ? sizeHint === "web"
      ? cropImage.webPath
      : cropImage.thumbPath
    : null;

  return (
    <div className={baseClasses}>
      {/* Served directly by Nginx in production (docs/architecture.md), so we
       *  skip Next's image optimizer by design. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : undefined}
        decoding="async"
        className="h-full w-full object-cover"
      />
      {cropSrc && (
        // CROP close-up revealed on hover over the photo. Lazy + low priority
        // so it never competes with the visible originals or the LCP;
        // decorative (the base <img> already carries the alt).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={cropSrc}
          alt=""
          aria-hidden
          loading="lazy"
          fetchPriority="low"
          decoding="async"
          className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-200 group-hover/thumb:opacity-100 motion-reduce:transition-none"
        />
      )}
    </div>
  );
}
