"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FallingOverlay, type ParticleKind } from "./falling-overlay";
import {
  CakeParticle,
  CloverParticle,
  DigitSixParticle,
  HashOneParticle,
  makeConfettiParticle,
  makeWatermarkSmileyParticle,
} from "./particle-kinds";
import { RisingEmbersLayer } from "./rising-embers";
import type { AnniversaryDates } from "@/lib/queries/anniversaries";

/** Debug override values accepted via `?effect=…`. Used to preview
 *  any of the four anniversary overlays on demand without waiting for
 *  the calendar to roll around. Temporary — keep until the project
 *  owner has verified each variant in production, then strip both this
 *  type and the trigger buttons on the home page. */
type ForcedVariant = "first" | "j111" | "j666" | "birthday";
const FORCED_PARAM_VALUES: ReadonlySet<ForcedVariant> = new Set([
  "first",
  "j111",
  "j666",
  "birthday",
]);

/**
 * Site-wide easter-egg overlay. The server passes the MM-DD strings of
 * the project's three special-find anniversaries (find #1, #111, #666)
 * via props; the client checks today's MM-DD in Europe/Prague time and
 * renders the matching variant. November 23rd (the project owner's
 * birthday) is hard-coded — it doesn't depend on Find data.
 *
 * Implementation notes:
 * - Today's date is computed on the client to stay correct across ISR
 *   cache windows. The first paint shows nothing; the overlay swaps
 *   in after the initial useEffect tick. For typical pages this is a
 *   single-frame flash that nobody notices.
 * - A timer reschedules the check at the next CE midnight, so visitors
 *   who keep a tab open across midnight get the new day's effect (or
 *   none) without a page reload.
 * - When more than one anniversary lands on the same day, the priority
 *   is birthday > first-find > #111 > #666 — chosen so the most
 *   personally-significant overlay wins. Coincidence is rare in
 *   practice (~ 1 / 365 each), so the simple cascade is fine.
 */

const TZ = "Europe/Prague";
const BIRTHDAY_MD = "11-23";

function computeTodayMD(): string {
  // YYYY-MM-DD then slice to MM-DD; Intl handles the tz conversion
  // without us pulling in date-fns / Luxon for this single use.
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return ymd.slice(5);
}

/** Milliseconds until the next Europe/Prague midnight, computed via
 *  the wall-clock parts in that timezone rather than UTC offset
 *  arithmetic — avoids the DST-day surprise where local midnight is
 *  23 or 25 hours away. */
function msUntilNextLocalMidnight(): number {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const h = get("hour");
  const m = get("minute");
  const s = get("second");
  const elapsedSinceLocalMidnight = ((h * 60 + m) * 60 + s) * 1000;
  const dayMs = 24 * 60 * 60 * 1000;
  // 30s buffer so we land just past midnight, not exactly on it (avoids
  // a tight race where the local clock hasn't yet ticked the new day).
  return Math.max(60_000, dayMs - elapsedSinceLocalMidnight + 30_000);
}

export function AnniversaryOverlay({
  anniversaries,
  watermarkSrc,
}: {
  anniversaries: AnniversaryDates;
  /** URL of the project's photo watermark — used by the birthday
   *  variant in place of an emoji smiley so the falling motif matches
   *  the brand mark used elsewhere on the site. `null` when the file
   *  isn't on disk; the birthday variant transparently drops the
   *  smiley kind in that case. */
  watermarkSrc: string | null;
}) {
  const [today, setToday] = useState<string | null>(null);
  const [forced, setForced] = useState<ForcedVariant | null>(null);
  const searchParams = useSearchParams();

  useEffect(() => {
    let cancelled = false;
    const update = () => {
      if (cancelled) return;
      setToday(computeTodayMD());
    };
    update();
    let timer = setTimeout(function tick() {
      update();
      timer = setTimeout(tick, msUntilNextLocalMidnight());
    }, msUntilNextLocalMidnight());
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  // Debug override — `?effect=first|j111|j666|birthday` lets the
  // project owner preview any variant on any day. Persisted in
  // sessionStorage so the override survives client navigation between
  // pages (the home-page debug buttons set the param, then the visitor
  // can roam to /sbirka, /mapa, etc. and keep seeing the effect).
  // `?effect=off` clears the override; useSearchParams re-fires this
  // effect on every URL change so the toggle reacts immediately.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const KEY = "ctyr-debug-effect";
    const v = searchParams.get("effect");
    if (v === "off") {
      sessionStorage.removeItem(KEY);
      setForced(null);
      return;
    }
    if (v && FORCED_PARAM_VALUES.has(v as ForcedVariant)) {
      sessionStorage.setItem(KEY, v);
      setForced(v as ForcedVariant);
      return;
    }
    const stored = sessionStorage.getItem(KEY);
    setForced(
      stored && FORCED_PARAM_VALUES.has(stored as ForcedVariant)
        ? (stored as ForcedVariant)
        : null,
    );
  }, [searchParams]);

  // SSR / first paint: render nothing to avoid hydration mismatch and
  // also to skip work for the 364/365 of visits where no overlay is due.
  if (today === null) return null;

  // Forced variant wins over the calendar so debug previews work even
  // on a date with its own real anniversary.
  const variant: ForcedVariant | null =
    forced ??
    (today === BIRTHDAY_MD
      ? "birthday"
      : anniversaries.firstFindMD && today === anniversaries.firstFindMD
        ? "first"
        : anniversaries.jubilee111MD && today === anniversaries.jubilee111MD
          ? "j111"
          : anniversaries.jubilee666MD && today === anniversaries.jubilee666MD
            ? "j666"
            : null);

  if (variant === "birthday") return <BirthdayOverlay watermarkSrc={watermarkSrc} />;
  if (variant === "first") return <FirstFindOverlay />;
  if (variant === "j111") return <Jubilee111Overlay />;
  if (variant === "j666") return <Jubilee666Overlay />;
  return null;
}

// ---------------------------------------------------------------------------
// Variants. Each composes `FallingOverlay` with a kinds array specific
// to the day. Counts tuned so a typical desktop viewport feels festive
// without becoming a forest — about 30–40 particles total.

function FirstFindOverlay() {
  // First-find day: clovers (the project's signature) plus bold "#1"
  // badges that nod at the milestone the day commemorates.
  const kinds: ReadonlyArray<ParticleKind> = [
    {
      render: CloverParticle,
      weight: 3,
      minSize: 14,
      maxSize: 26,
      opacityBase: 0.85,
    },
    {
      render: HashOneParticle,
      weight: 1,
      minSize: 16,
      maxSize: 28,
      opacityBase: 0.7,
    },
  ];
  return <FallingOverlay kinds={kinds} count={36} />;
}

function Jubilee111Overlay() {
  // #111 day: pure clover shower — same shape as the detail-page
  // heavenly overlay, just rendered through the generic falling shell.
  const kinds: ReadonlyArray<ParticleKind> = [
    {
      render: CloverParticle,
      weight: 1,
      minSize: 12,
      maxSize: 24,
      opacityBase: 0.85,
    },
  ];
  return <FallingOverlay kinds={kinds} count={36} />;
}

function Jubilee666Overlay() {
  // #666 day: red "6" digits drifting down + the rising-embers layer
  // beneath them for the hellish flavour. Vignette + smoke are
  // intentionally omitted (too aggressive for site-wide all-day use).
  const kinds: ReadonlyArray<ParticleKind> = [
    {
      render: DigitSixParticle,
      weight: 1,
      minSize: 14,
      maxSize: 26,
      opacityBase: 0.75,
    },
  ];
  return (
    <>
      <RisingEmbersLayer />
      <FallingOverlay kinds={kinds} count={28} noSway />
    </>
  );
}

function BirthdayOverlay({
  watermarkSrc,
}: {
  watermarkSrc: string | null;
}) {
  // 23.11. — author's birthday: clovers (project signature), confetti
  // in five festive hues, cake emoji, and the project's photo
  // watermark used as a smiley sprite. Higher count to sell the
  // celebratory feel; weight skewed so confetti reads as "scattered
  // noise" between the bigger clover/cake/smiley motifs.
  const kinds: ParticleKind[] = [
    {
      render: CloverParticle,
      weight: 3,
      minSize: 14,
      maxSize: 24,
      opacityBase: 0.85,
    },
    {
      render: CakeParticle,
      weight: 2,
      minSize: 20,
      maxSize: 30,
      opacityBase: 0.95,
    },
  ];
  // Watermark only contributes to the kinds list when its file is on
  // disk (the layout passed a non-null URL). Skipping the kind when
  // the watermark is missing avoids a broken-image storm on environments
  // without DATA_DIR/meta/VODOZNAK_BezJmena.png.
  if (watermarkSrc) {
    kinds.push({
      render: makeWatermarkSmileyParticle(watermarkSrc),
      weight: 2,
      minSize: 18,
      maxSize: 30,
      opacityBase: 0.9,
    });
  }
  // Five separate confetti renderers so colours genuinely vary
  // across particles instead of every confetti slug being one hue.
  for (let i = 0; i < 5; i++) {
    kinds.push({
      render: makeConfettiParticle(i),
      weight: 1,
      minSize: 8,
      maxSize: 14,
      opacityBase: 0.85,
    });
  }
  return <FallingOverlay kinds={kinds} count={48} />;
}
