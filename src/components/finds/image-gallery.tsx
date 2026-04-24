"use client";

import { useState } from "react";
import { ImageType } from "@prisma/client";
import type { PublicImage } from "@/lib/queries/finds";

/**
 * Tabs between ORIGINAL and CROP images, falls back to a single gallery
 * when only one type is present. Large viewer + thumbnail strip.
 */
export function ImageGallery({
  images,
  altBase,
}: {
  images: readonly PublicImage[];
  altBase: string;
}) {
  const originals = images.filter((i) => i.imageType === ImageType.ORIGINAL);
  const crops = images.filter((i) => i.imageType === ImageType.CROP);

  const [tab, setTab] = useState<"original" | "crop">(
    originals.length > 0 ? "original" : "crop",
  );
  const active = tab === "original" ? originals : crops;

  const [index, setIndex] = useState(0);
  const current = active[index] ?? active[0];

  if (images.length === 0) {
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
    <div className="space-y-3">
      {originals.length > 0 && crops.length > 0 && (
        <div
          role="tablist"
          aria-label="Typy fotografií"
          className="inline-flex rounded-lg border border-gray-200 bg-white p-1 text-sm"
        >
          <TabButton
            active={tab === "original"}
            onClick={() => {
              setTab("original");
              setIndex(0);
            }}
          >
            Originály ({originals.length})
          </TabButton>
          <TabButton
            active={tab === "crop"}
            onClick={() => {
              setTab("crop");
              setIndex(0);
            }}
          >
            Výřezy ({crops.length})
          </TabButton>
        </div>
      )}

      <div className="overflow-hidden rounded-xl bg-gray-100">
        {current ? (
          // Nginx-served; Next Image optimizer not needed.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={current.webPath}
            alt={`${altBase} – fotografie ${index + 1}`}
            className="max-h-[70vh] w-full object-contain"
          />
        ) : null}
      </div>

      {active.length > 1 && (
        <ul className="flex flex-wrap gap-2">
          {active.map((img, i) => (
            <li key={img.id}>
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-current={i === index ? "true" : undefined}
                className={`block overflow-hidden rounded-md border-2 ${
                  i === index ? "border-brand-500" : "border-transparent"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.thumbPath}
                  alt=""
                  className="h-16 w-16 object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-md px-3 py-1 transition ${
        active
          ? "bg-brand-50 text-brand-700"
          : "text-gray-600 hover:text-gray-900"
      }`}
    >
      {children}
    </button>
  );
}
