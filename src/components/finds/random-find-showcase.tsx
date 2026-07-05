"use client";

import { useCallback, useEffect, useState } from "react";
import { FindState } from "@prisma/client";
import { Link } from "@/i18n/navigation";
import { Maximize, MapPin, RefreshCw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { ImageGallery } from "./image-gallery";
import { RandomFindScreensaver } from "./random-find-screensaver";
import { StateBadges } from "./state-badges";
import { VoteButton } from "./vote-button";
import { formatDateTimeCs } from "@/lib/format";
import { photoDisplay } from "@/lib/photoBox";
import type { RandomFindShowcase } from "@/lib/queries/random-find";

/** The showcase photo may be taller than the find-detail page's (no
 *  competing content around it) but must still fit a 1080p viewport, so it's
 *  height-capped rather than full-width — a full-width portrait overflows.
 *  85 lets a landscape reach the full page column even on a scaled-down 4K
 *  viewport (~1080 CSS px tall) while a portrait still fits FullHD. */
const SHOWCASE_MAX_VH = 85;

const DEFAULT_ROTATION_MS = 60_000;
const DEFAULT_SCREENSAVER_MS = 10_000;

/**
 * Home-page widget that rotates through random finds. The initial
 * value comes from SSR so the first paint isn't a skeleton; once
 * mounted the widget polls `/api/random-find` every minute, on tab
 * focus, and on manual click of "Další".
 *
 * Layout is a vertical stack — metadata header row above, full-width
 * photo below, hint underneath. `ImageGallery` carries the lupa
 * interaction (hover/focus on the magnifier swaps ORIGINAL ↔ CROP).
 *
 * A thin countdown bar overlays the bottom edge of the photo and
 * drains left-to-right over `rotationMs`, then resets when the find
 * changes (via React `key` on the bar — the new element re-runs the
 * CSS animation from full).
 */
export function RandomFindShowcaseWidget({
  initial,
  rotationMs = DEFAULT_ROTATION_MS,
  screensaverMs = DEFAULT_SCREENSAVER_MS,
}: {
  initial: RandomFindShowcase | null;
  /** Auto-rotation interval in ms (admin-tunable home rotation setting). */
  rotationMs?: number;
  /** Screensaver rotation interval in ms, forwarded to the overlay. */
  screensaverMs?: number;
}) {
  const t = useTranslations("RandomFind");
  const tRow = useTranslations("FindRow");
  const locale = useLocale();
  const [find, setFind] = useState<RandomFindShowcase | null>(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [screensaverOpen, setScreensaverOpen] = useState(false);
  // Bumped every time the displayed find's countdown should restart — a
  // successful rotation/refresh, or returning from the screensaver. Both
  // the countdown bar (its `key`) and the auto-rotation interval (an
  // effect dep) read it, so the visible timer and the actual rotation
  // stay anchored to the same moment.
  const [cycleKey, setCycleKey] = useState(0);
  // Per-visitor "did I already vote for THIS find?" — populated on
  // mount + every time the find changes. Until the GET resolves we
  // show `voted=false` (server pre-paint has no cookies anyway).
  // Reset to null while refreshing so the button doesn't lie during
  // the (short) gap between find swap and state hydration.
  const [voted, setVoted] = useState<boolean>(false);

  const refresh = useCallback(async (manual = false) => {
    try {
      setRefreshing(true);
      // Manual clicks bypass the browser cache so the user sees a
      // brand-new find immediately. Auto-refreshes ride the
      // `cache-control: max-age=60` we set on the API route, which
      // keeps server load roughly flat regardless of visitor count.
      const res = await fetch("/api/random-find", {
        cache: manual ? "no-store" : "default",
      });
      if (!res.ok) return;
      const data = (await res.json()) as RandomFindShowcase | null;
      if (data) {
        setFind(data);
        setCycleKey((k) => k + 1);
      }
    } catch {
      /* swallow — keep the previous find on screen */
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Adopt the last image the screensaver showed (otherwise the inline
  // widget snaps back to the pre-fullscreen find) and restart the
  // countdown so the timer matches what's now on screen. Stable identity
  // so the overlay's close-path effects don't re-run on every re-render.
  const handleScreensaverClose = useCallback(
    (finalFind: RandomFindShowcase) => {
      setFind(finalFind);
      setCycleKey((k) => k + 1);
      setScreensaverOpen(false);
    },
    [],
  );

  useEffect(() => {
    // Pause auto-rotation while the screensaver covers the widget — no
    // background churn, and the timer re-anchors to the moment it closes.
    // `cycleKey` re-arms the interval on every find change so it stays in
    // lockstep with the countdown bar (also keyed on cycleKey).
    if (screensaverOpen) return;
    const i = setInterval(() => refresh(false), rotationMs);
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh(false);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(i);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh, rotationMs, screensaverOpen, cycleKey]);

  // Hydrate the per-visitor vote state whenever the find ID changes.
  // The GET endpoint is cheap (one DB hit + cookie/header read) and
  // sits on `private, no-store` so it never gets shared between
  // visitors. AbortController guards against an in-flight response
  // landing AFTER the find has already rotated again.
  const findId = find?.id ?? null;
  useEffect(() => {
    if (findId === null) return;
    const ac = new AbortController();
    fetch(`/api/finds/${findId}/vote`, {
      signal: ac.signal,
      credentials: "same-origin",
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { voted?: boolean } | null) => {
        if (data && typeof data.voted === "boolean") setVoted(data.voted);
      })
      .catch(() => {
        /* swallow — aborted or offline */
      });
    return () => ac.abort();
  }, [findId]);

  if (!find) return null;

  const altBase = find.isAnonymized
    ? tRow("anonymizedAlt", { id: find.id })
    : tRow("findAlt", { id: find.id });
  const foundAtDate = find.foundAt ? new Date(find.foundAt) : null;
  // Lost finds get the same desaturated treatment as the detail page; the
  // map deep-link is suppressed for anonymized finds (hasMapPosition is
  // already false for them server-side).
  const isLost = find.states.includes(FindState.LOST);
  // Explicit photo-box width for the overlay wrapper — must match the
  // ImageGallery figure (same rotate flag + maxVh) so the overlays line up.
  const disp = photoDisplay(
    find.primaryImage?.width,
    find.primaryImage?.height,
    { rotate: false, maxVh: SHOWCASE_MAX_VH },
  );

  return (
    <section className="mt-8" aria-live="polite">
      <style>{`
        @keyframes ctyr-rf-countdown {
          from { transform: scaleX(1); }
          to   { transform: scaleX(0); }
        }
        .ctyr-rf-countdown-fill {
          transform-origin: left center;
          animation: ctyr-rf-countdown ${rotationMs}ms linear forwards;
        }
        @media (prefers-reduced-motion: reduce) {
          .ctyr-rf-countdown-fill { animation: none; transform: scaleX(1); }
        }
      `}</style>

      {/* No section title, no card frame — the photo spans the full page
          column. The clickable "Náhodný 🍀 #id" heading (→ detail) sits at
          the photo's left edge; date, states, vote and the controls all
          live on the photo itself as overlays. */}
      <div className="mb-2 text-center">
        <Link
          href={`/sbirka/${find.id}`}
          className="text-2xl font-bold text-gray-900 transition hover:text-brand-700"
        >
          {t("heading")} #{find.id}
        </Link>
      </div>

      {/* Height-capped photo (SHOWCASE_MAX_VH) — big, but a portrait still
          fits a 1080p screen (full-width overflowed it). The wrapper takes
          the SAME explicit width as the ImageGallery figure so the overlays
          line up; an explicit width (not `w-fit`) avoids the shrink-to-zero
          collapse. */}
      <div
        className="relative mx-auto"
        style={{ width: disp?.widthCss, maxWidth: "100%" }}
      >
        <ImageGallery
          image={find.primaryImage}
          cropImage={find.cropImage}
          altBase={altBase}
          findId={find.id}
          muted={isLost}
          maxVh={SHOWCASE_MAX_VH}
          voteSlot={
            // Keyed by find.id so the rotation remounts it with the fresh
            // count + the voted state hydrated above.
            <VoteButton
              key={find.id}
              findId={find.id}
              initialVoted={voted}
              initialCount={find.voteCount}
              variant="overlay"
            />
          }
          statesSlot={
            find.states.length > 0 ? <StateBadges states={find.states} /> : null
          }
        />
        {/* Top-LEFT cluster — full-screen launcher, the rotate/refresh
            button (same action as the old "Další" button), then the
            "show on map" deep-link (suppressed for anonymized finds, whose
            hasMapPosition is false). All mirror the lupa's pill styling. */}
        <div className="absolute left-3 top-3 z-10 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setScreensaverOpen(true)}
            aria-label={t("screensaverStartAria")}
            title={t("screensaverStartTitle")}
            className="rounded-full bg-white/90 p-2 text-brand-700 shadow-md ring-1 ring-black/5 backdrop-blur transition hover:bg-white hover:text-brand-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <Maximize className="h-5 w-5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => refresh(true)}
            disabled={refreshing}
            aria-label={t("showAnotherAria")}
            title={t("showAnotherLabel")}
            className="rounded-full bg-white/90 p-2 text-brand-700 shadow-md ring-1 ring-black/5 backdrop-blur transition hover:bg-white hover:text-brand-800 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60"
          >
            <RefreshCw
              className={`h-5 w-5 ${refreshing ? "animate-spin" : ""}`}
              aria-hidden
            />
          </button>
          {find.hasMapPosition && (
            <Link
              href={`/mapa?find=${find.id}`}
              aria-label={t("showOnMapAria")}
              title={t("showOnMapAria")}
              className="inline-flex items-center justify-center rounded-full bg-white/90 p-2 text-brand-700 shadow-md ring-1 ring-black/5 backdrop-blur transition hover:bg-white hover:text-brand-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <MapPin className="h-5 w-5" aria-hidden />
            </Link>
          )}
        </div>
        {/* Bottom overlays: date/time on top, rotation hint below — stacked
            in the bottom-left corner. Always stacked (not split into corners
            on desktop) because the height-capped photo can be narrow enough
            that a left date + centred hint would still collide. */}
        <div className="absolute inset-x-3 bottom-3 z-10 flex flex-col items-start gap-1">
          {foundAtDate && (
            <div className="pointer-events-none rounded-md bg-white/90 px-2 py-1 text-xs font-medium text-brand-700 shadow-md ring-1 ring-black/5 backdrop-blur">
              {/* Pinned to Europe/Prague so SSR and client hydration render
                  the same clock time (this is a client component). */}
              {formatDateTimeCs(foundAtDate, locale, "Europe/Prague")}
            </div>
          )}
          <div className="pointer-events-none max-w-full rounded-md bg-white/90 px-2 py-1 text-left text-[11px] font-medium text-brand-700 shadow-md ring-1 ring-black/5 backdrop-blur">
            {t("rotationFooter", {
              seconds: Math.round(rotationMs / 1000),
              screensaverSeconds: Math.round(screensaverMs / 1000),
            })}
          </div>
        </div>
        {/* Countdown overlay strip at the bottom of the photo. The `key`
            is bumped whenever the find changes, so the inner fill remounts
            and the CSS animation restarts at scaleX=1. Decorative only. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-1.5 overflow-hidden bg-black/20"
          title={t("rotationTitle")}
        >
          <div
            key={cycleKey}
            className="ctyr-rf-countdown-fill h-full bg-brand-500"
          />
        </div>
      </div>

      {screensaverOpen && (
        <RandomFindScreensaver
          initial={find}
          rotationMs={screensaverMs}
          onClose={handleScreensaverClose}
        />
      )}
    </section>
  );
}
