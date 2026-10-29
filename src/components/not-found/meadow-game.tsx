"use client";

import { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { CloverShape } from "./clover-shape";
import { HuntFooter, type RoundRecord } from "./hunt-footer";
import { HowToPlay } from "./how-to-play";
import {
  MEADOW_MAX_CELL,
  meadowColumns,
  meadowRound,
  clockNow,
  newSeed,
  SHADES,
} from "./hunt";
import { usePersonalBests } from "./use-personal-bests";

/** Width the meadow may take before it is on screen (the section is
 *  max-w-7xl with px-4, the meadow has its own padding). */
function initialWidth(): number {
  return Math.min(window.innerWidth, 1280) - 56;
}

/**
 * 404 game „Louka“: a grid of three-leaf clovers with ONE four-leaf among
 * them. Wrong picks shake and count; the right one wins a real four-leaf
 * from the collection and a next round — bigger, more uniform, with decoys
 * (see hunt.ts). Buttons all the way down, so it works by mouse, finger and
 * keyboard; every cell has the same neutral label so a screen reader
 * doesn't give the answer away, and the result is announced in a live
 * region. Rendered client-only (see CloverHunt), so the random layout never
 * has to match a server render.
 */
export function MeadowGame() {
  const t = useTranslations("NotFound");
  const [round, setRound] = useState(1);
  const [seed, setSeed] = useState(newSeed);
  const [tries, setTries] = useState(0);
  const [found, setFound] = useState(false);
  const [total, setTotal] = useState(0);
  // Round clock: started when a round is laid out, one entry per round won.
  const [startedAt, setStartedAt] = useState(() => clockNow());
  const [times, setTimes] = useState<number[]>([]);
  const [shaking, setShaking] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const { bests, record } = usePersonalBests();
  const [lastRecord, setLastRecord] = useState<RoundRecord>(null);
  // Columns follow the page width, fixed for a round (a rotated phone
  // mustn't reshuffle the meadow mid-search); recomputed for the next one.
  const box = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(() => meadowColumns(initialWidth()));
  const layout = useMemo(() => meadowRound(round, seed, columns), [round, seed, columns]);

  function pick(i: number) {
    if (found) return;
    const n = tries + 1;
    setTries(n);
    if (i === layout.lucky) {
      const ms = clockNow() - startedAt;
      setFound(true);
      setTotal((x) => x + 1);
      setTimes((ts) => [...ts, ms]);
      setLastRecord(record("meadow", round, ms));
      setMessage(t("foundAfter", { count: n }));
    } else {
      setShaking(i);
      setMessage(layout.cells[i]!.bud ? t("budLeaf") : t("threeLeaf"));
      window.setTimeout(() => setShaking((s) => (s === i ? null : s)), 450);
    }
  }

  function nextRound() {
    const width = box.current?.clientWidth ?? initialWidth();
    setColumns(meadowColumns(width));
    setLastRecord(null);
    setRound((r) => r + 1);
    setSeed(newSeed());
    setTries(0);
    setFound(false);
    setStartedAt(clockNow());
    setMessage("");
  }

  return (
    <div ref={box} className="flex w-full flex-col items-center gap-5">
      <HowToPlay game="meadow" />
      <div
        className="grid w-full gap-0.5 rounded-2xl border border-brand-200 bg-brand-50/60 p-2 shadow-inner sm:gap-1 sm:p-3"
        style={{
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          maxWidth: columns * MEADOW_MAX_CELL,
        }}
      >
        {layout.cells.map((c, i) => {
          const isLucky = i === layout.lucky;
          return (
            <button
              key={`${seed}-${i}`}
              style={{ zIndex: found && isLucky ? 10 : c.z }}
              type="button"
              onClick={() => pick(i)}
              disabled={found}
              aria-label={t("cellLabel", { n: i + 1 })}
              className={[
                "relative flex aspect-square w-full items-center justify-center overflow-visible rounded-md p-0.5 transition",
                "hover:bg-white/80 focus-visible:outline-2 focus-visible:outline-brand-600",
                shaking === i ? "motion-safe:animate-[ctyr-shake_0.45s]" : "",
                found && isLucky
                  ? "bg-white ring-2 ring-amber-400 motion-safe:animate-[ctyr-pop_0.6s]"
                  : found
                    ? "opacity-30"
                    : "",
              ].join(" ")}
            >
              <CloverShape
                leaves={isLucky ? 4 : 3}
                bud={c.bud}
                rotate={c.rotate}
                className={`pointer-events-none h-full w-full ${found && isLucky ? "text-emerald-600" : SHADES[c.shade]}`}
                style={{ transform: `translate(${c.dx}%, ${c.dy}%) scale(${c.scale})` }}
              />
            </button>
          );
        })}
      </div>

      <HuntFooter
        game="meadow"
        bests={bests}
        record={lastRecord}
        round={round}
        tries={tries}
        total={total}
        found={found}
        startedAt={startedAt}
        times={times}
        message={message}
        onNext={nextRound}
      />

      <style>{`
        @keyframes ctyr-shake { 0%,100% { transform: translateX(0) } 25% { transform: translateX(-4px) rotate(-6deg) } 75% { transform: translateX(4px) rotate(6deg) } }
      `}</style>
    </div>
  );
}
