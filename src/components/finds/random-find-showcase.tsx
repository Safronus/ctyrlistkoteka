"use client";

import { useCallback, useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import { ArrowRight, MapPin, RefreshCw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { ImageGallery } from "./image-gallery";
import { formatDateCs, formatLocationId } from "@/lib/format";
import type { RandomFindShowcase } from "@/lib/queries/random-find";

const ROTATION_MS = 60_000;

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
 * drains left-to-right over `ROTATION_MS`, then resets when the find
 * changes (via React `key` on the bar — the new element re-runs the
 * CSS animation from full).
 */
export function RandomFindShowcaseWidget({
  initial,
}: {
  initial: RandomFindShowcase | null;
}) {
  const t = useTranslations("RandomFind");
  const tRow = useTranslations("FindRow");
  const locale = useLocale();
  const [find, setFind] = useState<RandomFindShowcase | null>(initial);
  const [refreshing, setRefreshing] = useState(false);

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
      if (data) setFind(data);
    } catch {
      /* swallow — keep the previous find on screen */
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const i = setInterval(() => refresh(false), ROTATION_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh(false);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(i);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  if (!find) return null;

  const altBase = find.isAnonymized
    ? tRow("anonymizedAlt", { id: find.id })
    : tRow("findAlt", { id: find.id });
  const foundAtDate = find.foundAt ? new Date(find.foundAt) : null;

  return (
    <section className="mt-8" aria-live="polite">
      <style>{`
        @keyframes ctyr-rf-countdown {
          from { transform: scaleX(1); }
          to   { transform: scaleX(0); }
        }
        .ctyr-rf-countdown-fill {
          transform-origin: left center;
          animation: ctyr-rf-countdown ${ROTATION_MS}ms linear forwards;
        }
        @media (prefers-reduced-motion: reduce) {
          .ctyr-rf-countdown-fill { animation: none; transform: scaleX(1); }
        }
      `}</style>

      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {t("heading")}
        </h2>
        <button
          type="button"
          onClick={() => refresh(true)}
          disabled={refreshing}
          className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm disabled:opacity-50"
          aria-label={t("showAnotherAria")}
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
            aria-hidden
          />
          <span>{t("showAnotherLabel")}</span>
        </button>
      </div>

      {/* Metadata header — single horizontal row above the photo so the
          photo can claim the full container width below. Wraps on
          narrow viewports; "Detail nálezu" floats to the right via
          `ml-auto`. */}
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1">
        <span className="text-2xl font-bold text-gray-900">
          #{find.id}
        </span>
        {foundAtDate && (
          <span className="text-sm text-gray-500">
            {formatDateCs(foundAtDate, locale)}
          </span>
        )}
        {find.isAnonymized ? (
          <span className="text-sm text-gray-500">
            {t("anonymizedLocation")}
          </span>
        ) : find.location ? (
          <span
            className="truncate text-sm text-gray-700"
            title={find.location.code}
          >
            {find.location.code}{" "}
            <span className="font-mono text-xs text-gray-500">
              {formatLocationId(find.location.id)}
            </span>
          </span>
        ) : (
          <span className="text-sm text-gray-500">{t("noLocation")}</span>
        )}
        <div className="ml-auto flex items-center gap-3">
          {find.hasMapPosition && (
            <Link
              href={`/mapa?find=${find.id}`}
              aria-label={t("showOnMapAria")}
              title={t("showOnMapAria")}
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            >
              <MapPin className="h-3.5 w-3.5" aria-hidden />
              <span>{t("showOnMapLabel")}</span>
            </Link>
          )}
          <Link
            href={`/sbirka/${find.id}`}
            className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
          >
            {t("detailLink")}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </div>

      <div className="relative">
        <ImageGallery
          image={find.primaryImage}
          cropImage={find.cropImage}
          altBase={altBase}
        />
        {/* Countdown overlay strip at the bottom of the photo. The
            `key` is bumped whenever the find changes, so the inner
            fill remounts and the CSS animation restarts at scaleX=1.
            The strip itself is non-interactive (decorative only). */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-1.5 overflow-hidden bg-black/20"
          title={t("rotationTitle")}
        >
          <div
            key={find.id}
            className="ctyr-rf-countdown-fill h-full bg-brand-500"
          />
        </div>
      </div>

      <p className="mt-2 text-xs text-gray-400">{t("rotationFooter")}</p>
    </section>
  );
}
