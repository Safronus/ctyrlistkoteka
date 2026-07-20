"use client";

import { useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import {
  Camera,
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  ExternalLink,
  HelpCircle,
  Images,
  Layers,
  MapPin,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { LocationListItem } from "@/lib/queries/locations";
import { versionedPhotoUrl } from "@/lib/assetVersion";
import { GpsValue } from "@/components/finds/gps-value";
import { DeviationCounts } from "@/components/finds/deviation-counts";
import { STATE_BADGE } from "@/lib/stateLabels";
import {
  formatAreaM2,
  formatDateTimeCs,
  formatDistance,
  formatLocationId,
  formatTimeSinceCs,
  formatDensity,
  locationDetailHref,
  mapThumbUrl,
} from "@/lib/format";
import type { FindState } from "@/generated/prisma/enums";

type RowT = ReturnType<typeof useTranslations<"LocationRow">>;

/** Mirror an expanded row into the URL (`?open=id,id2…`) via NATIVE
 *  replaceState — no navigation, no server refetch, no re-render of the other
 *  rows. It just rewrites the current /lokality history entry so that after
 *  the visitor clicks through to a find / the map and hits Back, the list
 *  re-renders with those rows expanded (the page reads `?open` and seeds each
 *  row's `defaultOpen`). Next 15 tracks native history writes, so Back
 *  restores the URL and re-SSRs the expanded list; native scroll restoration
 *  then returns the visitor to the row they left from. */
function syncOpenParam(id: number, open: boolean) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const ids = new Set(
    (url.searchParams.get("open") ?? "").split(",").filter(Boolean),
  );
  if (open) ids.add(String(id));
  else ids.delete(String(id));
  if (ids.size > 0) url.searchParams.set("open", [...ids].join(","));
  else url.searchParams.delete("open");
  window.history.replaceState(window.history.state, "", url.toString());
}

/** Is this location in the LIVE URL's `?open` list? Read on the CLIENT
 *  (window) so it reflects the real address bar even when Back served a stale
 *  cached render: the router cache keeps the server payload from the last full
 *  load, so the server-seeded `defaultOpen` prop lags a step behind after
 *  replaceState-only toggles. Reading the live URL is the source of truth. */
function isOpenInUrl(id: number): boolean {
  if (typeof window === "undefined") return false;
  return (new URLSearchParams(window.location.search).get("open") ?? "")
    .split(",")
    .includes(String(id));
}

export function LocationListRow({
  location,
  defaultOpen = false,
}: {
  location: LocationListItem;
  /** SSR seed from the page's `?open` param. The client re-reads the live URL
   *  on mount + Back (isOpenInUrl), so a stale router-cache render can't leave
   *  the row a step behind. */
  defaultOpen?: boolean;
}) {
  const t = useTranslations("LocationRow");
  // SSR uses the server-parsed seed (no window); the client reads the LIVE URL
  // so Back restoring `?open=…` expands the right rows even when the cached
  // server render was stale. On the initial load both agree (same URL) → no
  // hydration mismatch.
  const [open, setOpen] = useState(() =>
    typeof window === "undefined" ? defaultOpen : isOpenInUrl(location.id),
  );
  // Re-sync on Back/Forward in case the page is restored WITHOUT remounting
  // (then the initializer above doesn't re-run).
  useEffect(() => {
    const sync = () => setOpen(isOpenInUrl(location.id));
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [location.id]);
  const toggle = () =>
    setOpen((o) => {
      const next = !o;
      syncOpenParam(location.id, next);
      return next;
    });

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  };

  const isChild = !location.isAnonymized && location.parentId !== null;

  const tone = location.isAnonymized
    ? "bg-purple-50/60 hover:bg-purple-100/60 focus:bg-purple-100/60"
    : location.isGone
      ? "bg-rose-50/60 hover:bg-rose-100/60 focus:bg-rose-100/60"
      : "hover:bg-brand-50 focus:bg-brand-50";

  const indent = isChild
    ? "border-l-4 border-brand-200 bg-brand-50/40 pl-6 sm:pl-10"
    : "";

  return (
    <div id={`loc-${location.id}`} className="scroll-mt-24">
      <div
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={onKeyDown}
        aria-expanded={open}
        className={`flex w-full cursor-pointer items-stretch gap-4 p-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${tone} ${indent}`}
      >
        <RowThumb location={location} t={t} />
        <div className="flex min-w-0 flex-1 flex-col justify-between gap-1">
          <RowTitle location={location} isChild={isChild} t={t} />
          {!location.isAnonymized && (
            <>
              <RowMeta location={location} t={t} />
              {location.coordinates && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <GpsValue
                    lat={location.coordinates.lat}
                    lng={location.coordinates.lng}
                  />
                  {location.distanceFromDefault !== null && (
                    <span
                      className="text-xs text-gray-500"
                      title={t("distanceFromMapTitle")}
                    >
                      <span className="font-mono tabular-nums text-gray-800">
                        {formatDistance(location.distanceFromDefault)}
                      </span>{" "}
                      {t("distanceFromMap")}
                    </span>
                  )}
                </div>
              )}
            </>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <RowCount location={location} t={t} />
            {!location.isAnonymized && (
              <>
                <DetailLink location={location} t={t} />
                <MapLink location={location} t={t} />
              </>
            )}
            {/* FindsLink shown for every row including anonymized +
                gone. Individual finds keep their own anonymization
                on /sbirka (notes/GPS hidden per-find), so the link
                stays privacy-safe even when the parent location is
                anonymized. */}
            <FindsLink location={location} t={t} />
          </div>
        </div>
        <div
          aria-hidden
          className="flex shrink-0 items-center text-gray-400"
        >
          {open ? (
            <ChevronDown className="h-5 w-5" />
          ) : (
            <ChevronRight className="h-5 w-5" />
          )}
        </div>
      </div>

      {open && <StatsPanel location={location} t={t} />}
    </div>
  );
}

function RowThumb({
  location,
  t,
}: {
  location: LocationListItem;
  t: RowT;
}) {
  if (location.isAnonymized) {
    return (
      <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md border border-purple-200 bg-purple-50 text-purple-400 sm:h-24 sm:w-24">
        <HelpCircle className="h-10 w-10" aria-hidden />
        <span className="sr-only">{t("anonymizedAriaShort")}</span>
      </div>
    );
  }
  if (location.thumbnailUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={mapThumbUrl(location.thumbnailUrl)}
        alt=""
        aria-hidden
        loading="lazy"
        decoding="async"
        className="h-20 w-20 shrink-0 rounded-md border border-gray-200 object-cover sm:h-24 sm:w-24"
      />
    );
  }
  return (
    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md border border-dashed border-gray-300 bg-gray-50 text-2xl text-gray-300 sm:h-24 sm:w-24">
      🍀
    </div>
  );
}

function RowTitle({
  location,
  isChild,
  t,
}: {
  location: LocationListItem;
  isChild: boolean;
  t: RowT;
}) {
  const showPartsBadge = !location.isAnonymized && location.childCount > 0;
  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      {isChild && (
        <CornerDownRight
          className="h-3.5 w-3.5 shrink-0 self-center text-brand-500"
          aria-label={t("subPartAria")}
        />
      )}
      <span className="font-mono text-xs text-gray-500">
        {formatLocationId(location.id)}
      </span>
      <span
        className="truncate text-sm font-semibold text-gray-900"
        title={location.code}
      >
        {location.code}
      </span>
      {!location.isAnonymized &&
        location.displayName &&
        location.displayName !== location.code && (
          <span
            className="truncate text-sm text-gray-500"
            title={location.displayName}
          >
            ({location.displayName})
          </span>
        )}
      {showPartsBadge && (
        <span
          className="inline-flex items-center gap-1 rounded-md bg-brand-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand-800"
          title={t("partsBadgeTitle")}
        >
          <Layers className="h-3 w-3" aria-hidden />+{" "}
          {t("partsBadge", { count: location.childCount })}
        </span>
      )}
      {location.isAnonymized && (
        <span className="rounded-md bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-purple-800">
          {t("anonymizedBadge")}
        </span>
      )}
      {location.isGone && (
        <span className="rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-rose-800">
          {t("goneBadge")}
        </span>
      )}
      {location.hasRealPhoto && (
        <span
          className="inline-flex items-center rounded-md bg-emerald-100 px-1 py-0.5 text-emerald-800"
          title={t("hasRealPhotoTitle")}
          aria-label={t("hasRealPhotoTitle")}
        >
          <Camera className="h-3 w-3" aria-hidden />
        </span>
      )}
    </div>
  );
}

function RowMeta({
  location,
  t,
}: {
  location: LocationListItem;
  t: RowT;
}) {
  const estimate = location.areaIsEstimate;
  return (
    <p className="truncate text-xs text-gray-500">
      <span className="font-mono">{location.code}</span>
      {location.effectiveAreaM2 !== null && (
        <>
          {" · "}
          <span title={estimate ? t("areaEstimateTitle") : undefined}>
            {t("areaPrefix")} {estimate ? "≈ " : ""}
            {formatAreaM2(location.effectiveAreaM2)}
          </span>
        </>
      )}
      {location.aggregateDensityPer100m2 !== null && (
        <>
          {" · "}
          <span title={estimate ? t("areaEstimateTitle") : t("densityTitle")}>
            {t("densityPrefix")} {estimate ? "≈ " : ""}
            {formatDensity(location.aggregateDensityPer100m2)}
          </span>
        </>
      )}
    </p>
  );
}

function MapLink({
  location,
  t,
}: {
  location: LocationListItem;
  t: RowT;
}) {
  return (
    <Link
      href={`/mapa?focus=${location.id}`}
      onClick={(e) => e.stopPropagation()}
      title={t("mapLink")}
      className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm"
    >
      <MapPin className="h-3.5 w-3.5" aria-hidden />
      {/* Below lg the label is sr-only → icon-only button (the row's three
          buttons would otherwise wrap to several cramped lines on a phone);
          the title carries the tooltip. Full text returns at lg+. */}
      <span className="sr-only lg:not-sr-only">{t("mapLink")}</span>
    </Link>
  );
}

function DetailLink({
  location,
  t,
}: {
  location: LocationListItem;
  t: RowT;
}) {
  return (
    <Link
      href={locationDetailHref(location.id)}
      onClick={(e) => e.stopPropagation()}
      title={t("detailLink")}
      className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm"
    >
      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
      {/* icon-only < lg (see MapLink) */}
      <span className="sr-only lg:not-sr-only">{t("detailLink")}</span>
    </Link>
  );
}

function FindsLink({
  location,
  t,
}: {
  location: LocationListItem;
  t: RowT;
}) {
  return (
    <Link
      href={`/sbirka?loc=${location.id}`}
      onClick={(e) => e.stopPropagation()}
      title={t("findsLink")}
      className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm"
    >
      <Images className="h-3.5 w-3.5" aria-hidden />
      {/* icon-only < lg (see MapLink) */}
      <span className="sr-only lg:not-sr-only">{t("findsLink")}</span>
    </Link>
  );
}

function RowCount({
  location,
  t,
}: {
  location: LocationListItem;
  t: RowT;
}) {
  const hasChildren = location.childCount > 0;
  const view = location.aggregateStats;
  return (
    <p className="text-sm font-medium text-brand-700">
      {t("findCountClover", { count: view.total })}
      <DeviationCounts amber={view.amber} rose={view.rose} className="ml-1.5" />
      {hasChildren && (
        <span className="ml-2 text-xs font-normal text-gray-500">
          {t("subpartsCountSuffix")}
        </span>
      )}
      {view.anonymized > 0 && (
        <span className="ml-2 text-xs text-purple-600">
          {t("anonymizedCountSuffix", { count: view.anonymized })}
        </span>
      )}
    </p>
  );
}

function StatsPanel({
  location,
  t,
}: {
  location: LocationListItem;
  t: RowT;
}) {
  const tStates = useTranslations("States");
  const anon = location.isAnonymized;
  const view = location.aggregateStats;
  const stateMax = view.states.reduce((m, s) => Math.max(m, s.count), 0);

  return (
    <div
      className={`border-t px-3 py-4 sm:px-6 ${
        anon ? "border-purple-200 bg-purple-50" : "border-gray-200 bg-gray-50"
      }`}
    >
      {/* Anonymized locations DO show the state breakdown + first/last find
          here (the individual finds are already reachable via the row's
          "Zobrazit nálezy" link, each self-anonymizing on /sbirka). The note
          just makes clear that only the place's identity — exact location,
          GPS, map — stays withheld, not these aggregate counts. */}
      {anon && (
        <p className="mb-4 text-sm text-purple-900">
          {t("expandedAnonymized")}
        </p>
      )}
      {view.total === 0 ? (
        <p className="text-sm text-gray-500">{t("emptyForLocation")}</p>
      ) : (
        <div className="space-y-4">
          {/* First + last find as thumbnail cards. The total count and the
              "Vše ve sbírce" link are deliberately NOT repeated here — both
              already sit in the collapsed row above. The crop is the link to
              the find detail; the corner pin (non-anonymized locations only,
              so an anon spot's position can't leak) opens it on the map. */}
          {(view.firstFindId !== null || view.lastFindId !== null) && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {view.firstFindId !== null && (
                <FindCard
                  kind="first"
                  id={view.firstFindId}
                  cropUrl={location.firstFindCropUrl}
                  foundAt={view.firstFoundAt}
                  showMapPin={!anon}
                  t={t}
                />
              )}
              {view.lastFindId !== null &&
                view.lastFindId !== view.firstFindId && (
                  <FindCard
                    kind="last"
                    id={view.lastFindId}
                    cropUrl={location.lastFindCropUrl}
                    foundAt={view.lastFoundAt}
                    showMapPin={!anon}
                    t={t}
                  />
                )}
            </div>
          )}

          {view.states.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-700">
                {t("statesHeading")}
              </h3>
              <ul className="space-y-1.5">
                {view.states.map((s) => (
                  // Grid, not flex: a fixed-width first column for the state
                  // chip means every bar track starts at the same x and is
                  // the same length regardless of how wide the chip's label
                  // is (chips are left-aligned inside their column).
                  <li
                    key={s.state}
                    className="grid grid-cols-[7.5rem_1fr_2.5rem] items-center gap-2"
                  >
                    <span
                      className={`justify-self-start rounded-md px-2 py-0.5 text-xs font-medium ${STATE_BADGE[s.state]}`}
                    >
                      {tStates(s.state as FindState)}
                    </span>
                    <div className="h-2 overflow-hidden rounded-full bg-gray-200">
                      <div
                        className="h-full rounded-full bg-brand-500"
                        style={{
                          width:
                            stateMax > 0
                              ? `${(s.count / stateMax) * 100}%`
                              : "0%",
                        }}
                      />
                    </div>
                    <span className="text-right font-mono text-xs tabular-nums text-gray-600">
                      {s.count}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** First / last find as a thumbnail card: the CROP close-up links to the
 *  find detail, the corner pin opens it on the map (non-anonymized locations
 *  only — see `showMapPin`). Replaces the old total/first/last stat grid +
 *  the "První/Poslední nález" + "Vše ve sbírce" button row (all redundant
 *  with the collapsed row above). */
function FindCard({
  kind,
  id,
  cropUrl,
  foundAt,
  showMapPin,
  t,
}: {
  kind: "first" | "last";
  id: number;
  cropUrl: string | null;
  foundAt: string | null;
  /** Hidden for anonymized locations — opening the find on the map would
   *  reveal the hidden spot's position. The crop → find page stays (it
   *  self-anonymizes). */
  showMapPin: boolean;
  t: RowT;
}) {
  const locale = useLocale();
  const tTimeSince = useTranslations("TimeSince");
  const found = foundAt ? new Date(foundAt) : null;
  const title =
    kind === "first"
      ? t("firstFindTitle", { id })
      : t("lastFindTitle", { id });
  return (
    <div className="relative flex items-center gap-3 rounded-md border border-gray-200 bg-white p-3">
      {/* Crop → find detail. stopPropagation so the click doesn't also
          toggle the row open/closed. */}
      <Link
        href={`/sbirka/${id}`}
        onClick={(e) => e.stopPropagation()}
        aria-label={t("openFindAria", { id })}
        className="block h-16 w-16 shrink-0 overflow-hidden rounded-md border border-gray-200 bg-gray-50 transition hover:border-brand-300 hover:shadow-sm"
      >
        {cropUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={versionedPhotoUrl(cropUrl)}
            alt=""
            aria-hidden
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-2xl text-gray-300">
            🍀
          </span>
        )}
      </Link>
      {/* pr leaves room for the corner pin so the title never runs under it. */}
      <div className="min-w-0 flex-1 pr-6">
        <p className="text-sm font-semibold text-gray-900">{title}</p>
        {found && (
          <p className="text-xs text-gray-600">
            {formatDateTimeCs(found, locale)}
          </p>
        )}
        {found && (
          <p className="text-xs text-gray-400">
            {formatTimeSinceCs(found, tTimeSince)}
          </p>
        )}
      </div>
      {showMapPin && (
        <Link
          href={`/mapa?find=${id}`}
          onClick={(e) => e.stopPropagation()}
          aria-label={t("showFindOnMapAria")}
          title={t("showFindOnMapAria")}
          className="absolute right-2 top-2 inline-flex items-center justify-center rounded-md border border-gray-200 bg-white p-1 text-brand-700 transition hover:border-brand-200 hover:shadow-sm"
        >
          <MapPin className="h-4 w-4" aria-hidden />
        </Link>
      )}
    </div>
  );
}
