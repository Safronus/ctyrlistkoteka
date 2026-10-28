"use client";

import { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { CloverShape } from "./clover-shape";
import { HuntFooter, type RoundRecord } from "./hunt-footer";
import { clockNow, LENS_REFERENCE_AREA, lensRound, newSeed, SHADES, type LensClover } from "./hunt";
import { usePersonalBests } from "./use-personal-bests";

/** Field size before it is on screen — mirrors the classes on the field
 *  (full width up to max-w-7xl; h-72 / sm:h-96 / lg:h-[30rem]). */
function initialArea(): number {
  const w = Math.min(window.innerWidth, 1280) - 32;
  const h = window.innerWidth < 640 ? 288 : window.innerWidth < 1024 ? 384 : 480;
  return (w * h) / LENS_REFERENCE_AREA;
}

const STEP = 24; // keyboard move, px
const HIT = 20; // how close to the four-leaf's centre a pick must land, px

/**
 * 404 game „Lupa“: the meadow is out of focus; a magnifying glass (pointer,
 * finger, or the arrow keys once the field has focus) shows it sharp. Only
 * under the lens can a four-leaf be told from a three-leaf; click/tap — or
 * Enter — where it is. Each round: more clovers, a smaller lens, more blur,
 * decoys (hunt.ts). The blurred layer is the same meadow, so nothing gives
 * the clover away except looking. Rendered client-only (see CloverHunt).
 */
export function MagnifierGame() {
  const t = useTranslations("NotFound");
  const box = useRef<HTMLDivElement>(null);
  const [round, setRound] = useState(1);
  const [seed, setSeed] = useState(newSeed);
  const [lens, setLens] = useState<{ x: number; y: number } | null>(null);
  const [tries, setTries] = useState(0);
  const [found, setFound] = useState(false);
  const [total, setTotal] = useState(0);
  // Round clock: started when a round is laid out, one entry per round won.
  const [startedAt, setStartedAt] = useState(() => clockNow());
  const [times, setTimes] = useState<number[]>([]);
  const [message, setMessage] = useState("");
  const { bests, record } = usePersonalBests();
  const [lastRecord, setLastRecord] = useState<RoundRecord>(null);
  // Clover count follows the field area (same density on any screen),
  // fixed for a round and recomputed for the next one.
  const [area, setArea] = useState(initialArea);
  const layout = useMemo(() => lensRound(round, seed, area), [round, seed, area]);

  function check(x: number, y: number) {
    const el = box.current;
    if (found || !el) return;
    const n = tries + 1;
    setTries(n);
    const cx = (layout.lucky.x / 100) * el.clientWidth;
    const cy = (layout.lucky.y / 100) * el.clientHeight;
    if (Math.hypot(x - cx, y - cy) <= HIT) {
      const ms = clockNow() - startedAt;
      setFound(true);
      setTotal((v) => v + 1);
      setTimes((ts) => [...ts, ms]);
      setLastRecord(record("lens", round, ms));
      setLens({ x: cx, y: cy });
      setMessage(t("foundAfter", { count: n }));
    } else {
      setMessage(t("threeLeaf"));
    }
  }

  function local(e: { clientX: number; clientY: number }) {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function center() {
    const el = box.current;
    return el ? { x: el.clientWidth / 2, y: el.clientHeight / 2 } : null;
  }

  function onKey(e: React.KeyboardEvent) {
    const el = box.current;
    if (!el || found) return;
    const at = lens ?? center();
    if (!at) return;
    const move: Record<string, [number, number]> = {
      ArrowLeft: [-STEP, 0], ArrowRight: [STEP, 0], ArrowUp: [0, -STEP], ArrowDown: [0, STEP],
    };
    const d = move[e.key];
    if (d) {
      e.preventDefault();
      setLens({
        x: Math.min(el.clientWidth, Math.max(0, at.x + d[0])),
        y: Math.min(el.clientHeight, Math.max(0, at.y + d[1])),
      });
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      check(at.x, at.y);
    }
  }

  function nextRound() {
    const el = box.current;
    setArea(el ? (el.clientWidth * el.clientHeight) / LENS_REFERENCE_AREA : initialArea());
    setLastRecord(null);
    setRound((r) => r + 1);
    setSeed(newSeed());
    setTries(0);
    setFound(false);
    setStartedAt(clockNow());
    setLens(null);
    setMessage("");
  }

  const clover = (c: LensClover, key: string, leaves: 3 | 4, highlight = false) => (
    <CloverShape
      key={key}
      leaves={leaves}
      bud={c.bud}
      rotate={c.rotate}
      className={`absolute -translate-x-1/2 -translate-y-1/2 ${highlight ? "text-emerald-600" : SHADES[c.shade]}`}
      style={{ left: `${c.x}%`, top: `${c.y}%`, width: c.size, height: c.size }}
    />
  );
  const meadow = (sharp: boolean) => (
    <>
      {layout.clovers.map((c, i) => clover(c, `${seed}-${i}`, 3))}
      {clover(layout.lucky, `${seed}-lucky`, 4, sharp && found)}
    </>
  );
  const R = layout.lensRadius;

  return (
    <div className="flex w-full flex-col items-center gap-5">
      {/* A pointer/keyboard surface, not a form control — hence the role. */}
      <div
        ref={box}
        role="application"
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the arrow keys drive the lens
        tabIndex={0}
        aria-label={t("lensLabel")}
        onPointerMove={(e) => !found && setLens(local(e))}
        onFocus={() => !lens && setLens(center())}
        onClick={(e) => {
          const p = local(e);
          setLens(p);
          check(p.x, p.y);
        }}
        onKeyDown={onKey}
        className="relative h-72 w-full cursor-none touch-none overflow-hidden rounded-2xl border border-brand-200 bg-brand-50 shadow-inner focus-visible:outline-2 focus-visible:outline-brand-600 sm:h-96 lg:h-[30rem]"
      >
        <div className="absolute inset-0" style={{ filter: `blur(${layout.blur}px)` }}>
          {meadow(false)}
        </div>
        {lens && (
          <>
            <div
              className="absolute inset-0 bg-brand-50"
              style={{ clipPath: `circle(${R}px at ${lens.x}px ${lens.y}px)` }}
            >
              {meadow(true)}
            </div>
            <div
              aria-hidden
              className="pointer-events-none absolute rounded-full border-4 border-amber-700/70 shadow-[0_0_0_2px_rgba(255,255,255,0.7),0_6px_18px_rgba(0,0,0,0.25)]"
              style={{ left: lens.x - R, top: lens.y - R, width: R * 2, height: R * 2 }}
            />
          </>
        )}
      </div>

      <HuntFooter
        game="lens"
        bests={bests}
        record={lastRecord}
        round={round}
        tries={tries}
        total={total}
        found={found}
        startedAt={startedAt}
        times={times}
        message={message || t("lensHint")}
        onNext={nextRound}
      />
    </div>
  );
}
