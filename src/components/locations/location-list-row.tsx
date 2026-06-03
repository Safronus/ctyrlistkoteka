"use client";

import { useState } from "react";
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
import { GpsValue } from "@/components/finds/gps-value";
import { STATE_BADGE } from "@/lib/stateLabels";
import {
  formatAreaM2,
  formatDateTimeCs,
  formatDistance,
  formatLocationId,
  formatTimeSinceCs,
  formatDensity,
  locationDetailHref,
} from "@/lib/format";
import type { FindState } from "@prisma/client";

type RowT = ReturnType<typeof useTranslations<"LocationRow">>;

export function LocationListRow({ location }: { location: LocationListItem }) {
  const t = useTranslations("LocationRow");
  const [open, setOpen] = useState(false);
  const toggle = () => setOpen((o) => !o);

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
    <div>
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
        src={location.thumbnailUrl}
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
      className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm"
    >
      <MapPin className="h-3.5 w-3.5" aria-hidden />
      <span>{t("mapLink")}</span>
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
      className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm"
    >
      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
      <span>{t("detailLink")}</span>
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
      className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm"
    >
      <Images className="h-3.5 w-3.5" aria-hidden />
      <span>{t("findsLink")}</span>
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
      {t("countSuffix", { count: view.total })}
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
  if (location.isAnonymized) {
    return (
      <div className="border-t border-purple-200 bg-purple-50 px-3 py-4 text-sm text-purple-900 sm:px-6">
        {t("expandedAnonymized")}
      </div>
    );
  }

  const view = location.aggregateStats;
  const stateMax = view.states.reduce((m, s) => Math.max(m, s.count), 0);

  return (
    <div className="border-t border-gray-200 bg-gray-50 px-3 py-4 sm:px-6">
      {view.total === 0 ? (
        <p className="text-sm text-gray-500">{t("emptyForLocation")}</p>
      ) : (
        <div className="space-y-4">
          <SummaryRow
            ownTotal={location.stats.total}
            aggregateTotal={view.total}
            firstFoundAt={view.firstFoundAt}
            lastFoundAt={view.lastFoundAt}
            childCount={location.childCount}
            t={t}
          />

          <DetailLinks
            firstFindId={view.firstFindId}
            lastFindId={view.lastFindId}
            locationId={location.id}
            t={t}
          />

          {view.states.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                {t("statesHeading")}
              </h3>
              <ul className="space-y-1.5">
                {view.states.map((s) => (
                  <li key={s.state} className="flex items-center gap-2">
                    <span
                      className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${STATE_BADGE[s.state]}`}
                    >
                      {tStates(s.state as FindState)}
                    </span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-200">
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
                    <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums text-gray-600">
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

function SummaryRow({
  ownTotal,
  aggregateTotal,
  firstFoundAt,
  lastFoundAt,
  childCount,
  t,
}: {
  ownTotal: number;
  aggregateTotal: number;
  firstFoundAt: string | null;
  lastFoundAt: string | null;
  childCount: number;
  t: RowT;
}) {
  const locale = useLocale();
  const tTimeSince = useTranslations("TimeSince");
  const first = firstFoundAt ? new Date(firstFoundAt) : null;
  const last = lastFoundAt ? new Date(lastFoundAt) : null;
  const hasChildren = childCount > 0;
  const totalSub = hasChildren
    ? t("ownVsChildren", {
        own: ownTotal,
        children: aggregateTotal - ownTotal,
      })
    : null;
  return (
    <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
      <Stat
        label={t("totalFinds")}
        value={String(aggregateTotal)}
        sub={totalSub}
      />
      <Stat
        label={t("firstFound")}
        value={first ? formatDateTimeCs(first, locale) : "—"}
        sub={first ? formatTimeSinceCs(first, tTimeSince) : null}
      />
      <Stat
        label={t("lastFound")}
        value={last ? formatDateTimeCs(last, locale) : "—"}
        sub={last ? formatTimeSinceCs(last, tTimeSince) : null}
      />
    </dl>
  );
}

function DetailLinks({
  firstFindId,
  lastFindId,
  locationId,
  t,
}: {
  firstFindId: number | null;
  lastFindId: number | null;
  locationId: number;
  t: RowT;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {firstFindId !== null && (
        <Link
          href={`/sbirka/${firstFindId}`}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm"
        >
          {t("firstFindLink", { id: firstFindId })}
        </Link>
      )}
      {lastFindId !== null && lastFindId !== firstFindId && (
        <Link
          href={`/sbirka/${lastFindId}`}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm"
        >
          {t("lastFindLink", { id: lastFindId })}
        </Link>
      )}
      <Link
        href={`/sbirka?loc=${locationId}`}
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm"
      >
        {t("allInCollectionLink")}
      </Link>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string | null;
}) {
  return (
    <div className="rounded-md border border-gray-200 bg-white p-3">
      <dt className="text-xs font-medium text-gray-500">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-gray-900">{value}</dd>
      {sub && <dd className="mt-0.5 text-xs text-gray-500">{sub}</dd>}
    </div>
  );
}
