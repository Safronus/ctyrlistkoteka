import type { PublicImage } from "@/lib/queries/finds";

/**
 * Renders the find's main photo (the ORIGINAL image). Only one image is
 * shown — duplicates from imports or stray rotated variants are ignored.
 * The CROP, if any, is rendered separately in the find detail's Detaily
 * panel; there's no toggle.
 */
export function ImageGallery({
  image,
  altBase,
}: {
  image: PublicImage | null;
  altBase: string;
}) {
  if (!image) {
    return (
      <div className="flex aspect-video items-center justify-center rounded-xl bg-gradient-to-br from-brand-50 to-brand-100">
        <span aria-hidden className="text-4xl opacity-40">
          🍀
        </span>
        <span className="sr-only">Žádná fotografie</span>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl bg-gray-100">
      {/* Served by Nginx; Next Image optimizer not needed. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.webPath}
        alt={altBase}
        className="max-h-[70vh] w-full object-contain"
      />
    </div>
  );
}
