import type { PublicImage } from "@/lib/queries/finds";

/**
 * Renders the primary image for a find. Falls back to a CSS placeholder
 * when no image is available (seed data or NO_PHOTO finds). A plain <img>
 * is used — images are served statically by Nginx in production (see
 * docs/architecture.md).
 */
export function FindThumbnail({
  image,
  alt,
  className = "",
  sizeHint = "thumb",
}: {
  image: PublicImage | null;
  alt: string;
  className?: string;
  sizeHint?: "thumb" | "web";
}) {
  const baseClasses =
    "relative overflow-hidden bg-gradient-to-br from-brand-50 to-brand-100 " +
    className;

  if (!image) {
    return (
      <div className={baseClasses} aria-label="Žádná fotografie">
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
        loading="lazy"
        decoding="async"
        className="h-full w-full object-cover"
      />
    </div>
  );
}
