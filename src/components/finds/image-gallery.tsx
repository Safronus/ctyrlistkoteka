"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import type { PublicImage } from "@/lib/queries/finds";

/**
 * Renders the find's main photo (ORIGINAL) with an optional zoom button.
 * When a CROP is available, hovering or focusing the magnifier in the
 * top-right swaps the displayed image to the crop. Both images are mounted
 * at once and cross-faded via opacity so the swap is instant.
 */
export function ImageGallery({
  image,
  cropImage,
  altBase,
}: {
  image: PublicImage | null;
  cropImage: PublicImage | null;
  altBase: string;
}) {
  const [showCrop, setShowCrop] = useState(false);

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
            className={`pointer-events-none absolute inset-0 m-auto max-h-[70vh] w-full object-contain transition-opacity duration-150 ${
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
    </div>
  );
}
