import { ImageType } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import type { PublicImage } from "@/lib/queries/finds";

/**
 * Renders one image for a find. Falls back to a CSS placeholder when no
 * image is available (seed data or NO_PHOTO finds). A plain <img> is used —
 * images are served statically by Nginx in production (see
 * docs/architecture.md).
 *
 * On /sbirka the callers pass the CROP close-up (via `cropVariant`) as the
 * thumbnail: at small sizes the clover close-up reads better than the full
 * photo, and the full photo is one click away on the find detail page.
 */

/** The CROP close-up of a find — used as the /sbirka thumbnail. Returns null
 *  when the find has no distinct crop image, so the caller falls back to the
 *  primary (original) photo. */
export function cropVariant(
  primary: PublicImage | null,
  images: PublicImage[],
): PublicImage | null {
  const crop = images.find((i) => i.imageType === ImageType.CROP) ?? null;
  return crop && crop.id !== primary?.id ? crop : null;
}

export async function FindThumbnail({
  image,
  alt,
  className = "",
  sizeHint = "thumb",
  priority = false,
}: {
  image: PublicImage | null;
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
    "relative overflow-hidden bg-gradient-to-br from-brand-50 to-brand-100 " +
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
    </div>
  );
}
