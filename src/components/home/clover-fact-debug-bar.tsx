"use client";

import { CLOVER_TEXTS } from "@/lib/cloverTexts";

/**
 * Temporary debug helper for the clover-fact rotator. Each button
 * dispatches a `clover-fact-force` CustomEvent that `CloverFactCard`
 * listens for and uses to override its current index. Removing this
 * component (and the listener block in clover-fact-card.tsx) is the
 * full cleanup — no other wiring depends on it.
 */
export function CloverFactDebugBar() {
  const force = (id: number) => {
    window.dispatchEvent(
      new CustomEvent("clover-fact-force", { detail: { id } }),
    );
  };

  const pickRandom = (predicate: (t: (typeof CLOVER_TEXTS)[number]) => boolean) => {
    const pool = CLOVER_TEXTS.filter(predicate);
    if (pool.length === 0) return;
    const target = pool[Math.floor(Math.random() * pool.length)];
    if (target) force(target.id);
  };

  return (
    <div className="mx-auto mt-6 flex max-w-2xl flex-wrap items-center justify-center gap-2 rounded-md border-2 border-dashed border-amber-400 bg-amber-50/80 p-3 text-xs">
      <span className="font-mono font-bold uppercase tracking-wider text-amber-700">
        DEBUG
      </span>
      <button
        type="button"
        onClick={() => force(111)}
        className="rounded bg-emerald-600 px-2 py-1 font-medium text-white hover:bg-emerald-700"
      >
        #111 (báseň, happy)
      </button>
      <button
        type="button"
        onClick={() => force(666)}
        className="rounded bg-red-700 px-2 py-1 font-medium text-white hover:bg-red-800"
      >
        #666 (demonic)
      </button>
      <button
        type="button"
        onClick={() => pickRandom((t) => t.author === true && !t.vibe)}
        className="rounded bg-amber-600 px-2 py-1 font-medium text-white hover:bg-amber-700"
      >
        Random BONUS
      </button>
      <button
        type="button"
        onClick={() => pickRandom((t) => !t.author)}
        className="rounded bg-gray-600 px-2 py-1 font-medium text-white hover:bg-gray-700"
      >
        Random regular
      </button>
      <span className="ml-1 text-amber-700/70">
        ({CLOVER_TEXTS.length} textů, z toho{" "}
        {CLOVER_TEXTS.filter((t) => t.author).length} BONUS)
      </span>
    </div>
  );
}
