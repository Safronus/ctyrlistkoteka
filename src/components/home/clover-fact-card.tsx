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

  // Author entries get a clover-themed paper variant: emerald gradient
  // background, green thumbtack, BONUS badge with the kind override
  // ("Rada autora" / "Báseň autora" / …). The dual rendering lives in
  // small className unions rather than a separate component so layout,
  // tilt, and ID badge stay identical and the DOM diff between rotations
  // is minimal.
  const isAuthor = text.author === true;
  const paperBg = isAuthor
    ? "bg-gradient-to-br from-emerald-50 via-emerald-50/80 to-emerald-100/70"
    : "bg-[#fffdf7]";
  const paperRing = isAuthor
    ? "ring-1 ring-emerald-200/70"
    : "ring-1 ring-amber-200/60";
  const pinDisc = isAuthor
    ? "bg-emerald-600 ring-2 ring-emerald-300"
    : "bg-rose-500 ring-2 ring-rose-300";
  const pinDot = isAuthor ? "bg-emerald-200" : "bg-rose-200";
  const titleColor = isAuthor ? "text-emerald-900" : "text-gray-900";
  const textColor = isAuthor ? "text-emerald-950/80" : "text-gray-700";

  return (
    // The wrapper isolates the rotation from the rest of the layout so
    // adjacent flex/grid math doesn't see a slightly-taller bounding
    // box. `aria-live="polite"` lets screen readers announce the new
    // text on rotation without interrupting the user.
    <div className="flex justify-center lg:justify-end">
      <aside
        aria-live="polite"
        aria-label={
          isAuthor ? "Bonusová drobnost autora" : "Drobnost o čtyřlístcích"
        }
        className={`relative w-72 max-w-full -rotate-[2deg] rounded-sm p-5 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.25)] sm:w-80 ${paperBg} ${paperRing}`}
      >
        {/* Faux thumbtack — small disc with a darker centre, hovering
            slightly above the top edge of the paper. Rotates with the
            paper (it's "pinned" to it, not to the wall). */}
        <span
          aria-hidden
          className={`absolute -top-3 right-6 inline-flex h-5 w-5 items-center justify-center rounded-full shadow-[0_2px_4px_rgba(0,0,0,0.25)] ${pinDisc}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${pinDot}`} />
        </span>

        <div className="flex items-baseline justify-between gap-2">
          <p
            className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${
              isAuthor ? "text-emerald-700" : "text-gray-500"
            }`}
          >
            {isAuthor && text.kind ? text.kind : categoryLabel}
          </p>
          {isAuthor ? (
            <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-sm">
              Bonus
            </span>
          ) : (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ring-1 ${SOURCE_TONE[text.source_type]}`}
            >
              {SOURCE_LABELS[text.source_type]}
            </span>
          )}
        </div>

        <h3
          className={`mt-1.5 font-serif text-base font-semibold ${titleColor}`}
        >
          {text.title}
        </h3>
        <p
          // Author rhymes/rady use newlines we want preserved (whitespace-pre-line)
          // so the báseň keeps its line breaks. Regular entries flow as
          // a single paragraph and the property is harmless there.
          className={`mt-2 whitespace-pre-line font-serif text-sm italic leading-relaxed ${textColor}`}
        >
          {text.text}
        </p>

        {/* Fact number stamped diagonally in the bottom-right corner.
            Uses the original JSON `id` — stable across visits so each
            fact has a fixed "#N" identity even though the on-disk
            shuffle changes the rotation order. */}
        <span
          aria-hidden
          className={`absolute bottom-2 right-3 rotate-[8deg] font-serif text-xs italic ${
            isAuthor ? "text-emerald-700/60" : "text-gray-400"
          }`}
        >
          #{text.id}
        </span>
      </aside>
    </div>
  );
}
