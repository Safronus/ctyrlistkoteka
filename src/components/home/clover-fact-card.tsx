"use client";

import { useEffect, useState } from "react";
import { CLOVER_TEXTS, type CloverTextSource } from "@/lib/cloverTexts";

const ROTATION_MS = 120_000;

const SOURCE_LABELS: Record<CloverTextSource, string> = {
  fact: "fakt",
  lore: "pověst",
  creative: "tvorba",
};

const SOURCE_TONE: Record<CloverTextSource, string> = {
  fact: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  lore: "bg-amber-100 text-amber-800 ring-amber-200",
  creative: "bg-violet-100 text-violet-800 ring-violet-200",
};

const CATEGORY_LABELS: Record<string, string> = {
  botany: "Botanika",
  culture: "Kultura",
  folklore: "Folklór",
  history: "Historie",
  literature: "Literatura",
  mythology: "Mytologie",
  poetry: "Poezie",
  records: "Rekordy",
  science: "Věda",
  trivia: "Drobnosti",
};

/**
 * Pinned-paper note next to the home-page hero with a rotating clover
 * curiosity. The 200 texts live in a once-shuffled JSON bundle (see
 * scripts/shuffle-clover-texts.ts); on every visit the client picks a
 * random starting index — *not* localStorage-cursored — and then
 * advances by one every two minutes. Reload counts as a fresh visit
 * and lands on a new random text. No interactivity beyond that.
 *
 * SSR renders the first array entry as a stable fallback; the random
 * pick happens in `useEffect`, so non-JS visitors still see one valid
 * text and JS visitors briefly glimpse it before hydration swaps.
 */
export function CloverFactCard() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (CLOVER_TEXTS.length === 0) return;
    setIndex(Math.floor(Math.random() * CLOVER_TEXTS.length));
    const i = setInterval(() => {
      setIndex((prev) => (prev + 1) % CLOVER_TEXTS.length);
    }, ROTATION_MS);
    return () => clearInterval(i);
  }, []);

  const text = CLOVER_TEXTS[index];
  if (!text) return null;

  const categoryLabel = CATEGORY_LABELS[text.category] ?? text.category;

  return (
    // The wrapper isolates the rotation from the rest of the layout so
    // adjacent flex/grid math doesn't see a slightly-taller bounding
    // box. `aria-live="polite"` lets screen readers announce the new
    // text on rotation without interrupting the user.
    <div className="flex justify-center lg:justify-end">
      <aside
        aria-live="polite"
        aria-label="Drobnost o čtyřlístcích"
        className="relative w-72 max-w-full -rotate-[2deg] rounded-sm bg-[#fffdf7] p-5 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.25)] ring-1 ring-amber-200/60 sm:w-80"
      >
        {/* Faux thumbtack — small disc with a darker centre, hovering
            slightly above the top edge of the paper. Rotates with the
            paper (it's "pinned" to it, not to the wall). */}
        <span
          aria-hidden
          className="absolute -top-3 right-6 inline-flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 shadow-[0_2px_4px_rgba(0,0,0,0.25)] ring-2 ring-rose-300"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-rose-200" />
        </span>

        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">
            {categoryLabel}
          </p>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ring-1 ${SOURCE_TONE[text.source_type]}`}
          >
            {SOURCE_LABELS[text.source_type]}
          </span>
        </div>

        <h3 className="mt-1.5 font-serif text-base font-semibold text-gray-900">
          {text.title}
        </h3>
        <p className="mt-2 font-serif text-sm italic leading-relaxed text-gray-700">
          {text.text}
        </p>
      </aside>
    </div>
  );
}
