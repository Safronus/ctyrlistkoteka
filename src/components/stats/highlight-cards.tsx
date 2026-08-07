"use client";

import { useState } from "react";
import { Compass, Info, MapPin } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  formatDateTimeCs,
  formatDistance,
  formatLocationId,
  formatTimeSinceCs,
  locationDetailHref,
} from "@/lib/format";
import type {
  DistanceOctant,
  FarthestFindHighlight,
  FindHighlight,
} from "@/lib/queries/stats";
import { DistanceRose } from "@/components/stats/distance-rose";

/**
 * The three "record" cards under the hero tiles. Client-side because each one
 * now flips between two or three readings of the same idea — first/last across
 * the whole collection vs. within a year vs. within a day, farthest vs.
 * nearest, highest vs. lowest.
 *
 * Everything that needs the country dataset (the flag, the localized country
 * name) is resolved on the server and handed over as plain strings: pulling
 * `world-countries` into the client bundle for one label would cost far more
 * than it's worth.
 */

/** A place, pre-formatted by the server so this file needs no geo lookups. */
export interface PlaceCardView {
  id: number;
  code: string;
  altitudeM: number;
  altitudeSource: string | null;
  city: string | null;
  countryLabel: string | null;
  countryFlag: string | null;
  count: number;
}

type WhenMode = "global" | "year" | "day";

export function HighlightCards({
  firstFind,
  lastFind,
  earliestInYear,
  latestInYear,
  earliestInDay,
  latestInDay,
  farthestFind,
  nearestFind,
  distanceRose,
  highestPlace,
  lowestPlace,
}: {
  firstFind: FindHighlight | null;
  lastFind: FindHighlight | null;
  earliestInYear: FindHighlight | null;
  latestInYear: FindHighlight | null;
  earliestInDay: FindHighlight | null;
  latestInDay: FindHighlight | null;
  farthestFind: FarthestFindHighlight | null;
  nearestFind: FarthestFindHighlight | null;
  distanceRose: readonly DistanceOctant[];
  highestPlace: PlaceCardView | null;
  lowestPlace: PlaceCardView | null;
}) {
  const t = useTranslations("Statistiky");
  const tTime = useTranslations("TimeSince");
  const locale = useLocale();

  const [when, setWhen] = useState<WhenMode>("global");
  const [nearest, setNearest] = useState(false);
  const [lowest, setLowest] = useState(false);

  // A reading is offered only when it has at least one side to show — a
  // collection with no clock-bearing EXIF simply never gets the "day" tab.
  const whenOptions: Array<{
    value: WhenMode;
    label: string;
    pair: readonly [FindHighlight | null, FindHighlight | null];
  }> = (
    [
      {
        value: "day",
        label: t("whenToggleDay"),
        pair: [earliestInDay, latestInDay],
      },
      {
        value: "year",
        label: t("whenToggleYear"),
        pair: [earliestInYear, latestInYear],
      },
      {
        value: "global",
        label: t("whenToggleGlobal"),
        pair: [firstFind, lastFind],
      },
    ] as const
  ).filter((o) => o.pair[0] ?? o.pair[1]);

  const active =
    whenOptions.find((o) => o.value === when) ??
    whenOptions.find((o) => o.value === "global") ??
    whenOptions[0];
  const [firstOf, lastOf] = active?.pair ?? [null, null];

  const distanceCard = nearest && nearestFind ? nearestFind : farthestFind;
  // One point per direction: the farthest (or nearest) find that way. Not an
  // average — this way every vertex is a real find, and the one that also
  // holds the overall record is marked.
  const roseValue = (o: DistanceOctant) =>
    nearest ? o.nearMeters : o.farMeters;
  const roseFindId = (o: DistanceOctant) =>
    nearest ? o.nearFindId : o.farFindId;
  const recordOctant =
    distanceCard === null
      ? null
      : (distanceRose.find((o) => roseFindId(o) === distanceCard.id)?.octant ??
        null);
  // The rose has room for ~8 characters per spoke, so its numbers are coarser
  // than the headline figure: no decimals past 100 km ("1 725 km", not
  // "1 725,084 km"). The tooltip still carries the exact value.
  const roseLabel = (m: number) =>
    m >= 100_000
      ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(m / 1000)} km`
      : formatDistance(m, locale);
  const rosePoints = distanceRose.some((o) => roseValue(o) !== null)
    ? distanceRose.map((o) => {
        const v = roseValue(o);
        return {
          abbr: t(`compassAbbr${o.octant}`),
          value: v === null ? null : roseLabel(v),
          isRecord: o.octant === recordOctant,
          tooltip:
            v === null
              ? `${t(`compassName${o.octant}`)}: —`
              : `${t(`compassName${o.octant}`)}: ${formatDistance(v, locale)}`,
        };
      })
    : null;
  const recordDirection =
    recordOctant === null ? null : t(`compassName${recordOctant}`);
  const placeCard = lowest && lowestPlace ? lowestPlace : highestPlace;

  if (!active && !distanceCard && !placeCard) return null;

  return (
    <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {active && (
        // Spans the row: it holds two readings side by side, so it needs the
        // width the single-value cards below don't.
        <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-5 md:col-span-2">
          <CardHeader
            title={
              when === "global"
                ? t("whenHeadingGlobal")
                : when === "year"
                  ? t("whenHeadingYear")
                  : t("whenHeadingDay")
            }
            toggle={
              whenOptions.length > 1 ? (
                <Toggle
                  value={when}
                  options={whenOptions.map((o) => ({
                    value: o.value,
                    label: o.label,
                  }))}
                  onChange={(v) => setWhen(v as WhenMode)}
                  ariaLabel={t("whenToggleAria")}
                />
              ) : null
            }
            position="corner"
          />
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FindHalf
              caption={
                when === "day" ? t("whenEarliestOfDay") : t("whenFirstLabel")
              }
              find={firstOf}
              locale={locale}
              t={t}
              tTime={tTime}
            />
            <FindHalf
              caption={
                when === "day" ? t("whenLatestOfDay") : t("whenLastLabel")
              }
              find={lastOf}
              locale={locale}
              t={t}
              tTime={tTime}
            />
          </div>
        </div>
      )}

      {distanceCard && (
        <div className="flex flex-col rounded-xl border border-gray-200 bg-gray-50 p-5">
          {/* Title + toggle live INSIDE the left column, not above both, so the
              rose can use the card's full height instead of pushing it taller.
              Side by side only from `xl`: this card shares a two-up grid from
              `md`, so between those breakpoints two thirds of half a page left
              the title wrapping mid-word and squeezed the rose down to a dot.
              Below `xl` the rose simply sits under the record at full width. */}
          <div className="flex flex-1 flex-col gap-3 xl:flex-row xl:items-stretch">
            <div className="flex flex-col xl:basis-2/3">
              <CardHeader
                title={
                  nearest
                    ? t("highlightNearestFind")
                    : t("highlightFarthestFind")
                }
                toggle={
                  nearestFind && farthestFind ? (
                    <Toggle
                      value={nearest ? "near" : "far"}
                      options={[
                        { value: "near", label: t("distanceToggleNear") },
                        { value: "far", label: t("distanceToggleFar") },
                      ]}
                      onChange={(v) => setNearest(v === "near")}
                      ariaLabel={t("distanceToggleAria")}
                    />
                  ) : null
                }
                position="corner"
              />
              <div className="flex flex-1 flex-col justify-center py-2">
              <FindBody
                find={distanceCard}
                locale={locale}
                t={t}
                tTime={tTime}
              />
              <p
                className="mt-3 flex items-center justify-center gap-1.5 text-xs text-gray-500"
                title={t("distanceFromDefaultTitle")}
              >
                <Compass className="h-3.5 w-3.5 text-brand-700" aria-hidden />
                <span className="font-mono tabular-nums text-gray-900">
                  {formatDistance(distanceCard.distanceMeters, locale)}
                </span>
                <span>{t("distanceFromMapSuffix")}</span>
                {recordDirection && (
                  <span className="text-gray-600">
                    {t("distanceDirection", { direction: recordDirection })}
                  </span>
                )}
              </p>
              <div className="mt-3">
                <FindButtons find={distanceCard} t={t} />
              </div>
              </div>
            </div>
            {rosePoints && (
              <div className="flex items-center justify-center xl:basis-1/3">
                <DistanceRose
                  points={rosePoints}
                  legend={
                    nearest
                      ? t("distanceRoseNearLegend")
                      : t("distanceRoseFarLegend")
                  }
                />
              </div>
            )}
          </div>
        </div>
      )}

      {placeCard && (
        <div className="flex flex-col rounded-xl border border-gray-200 bg-gray-50 p-5">
          <CardHeader
            title={
              lowest ? t("highlightLowestPlace") : t("highlightHighestPlace")
            }
            toggle={
              highestPlace && lowestPlace && highestPlace.id !== lowestPlace.id ? (
                <Toggle
                  value={lowest ? "low" : "high"}
                  options={[
                    { value: "low", label: t("altitudeToggleLow") },
                    { value: "high", label: t("altitudeToggleHigh") },
                  ]}
                  onChange={(v) => setLowest(v === "low")}
                  ariaLabel={t("altitudeToggleAria")}
                />
              ) : null
            }
            position="corner"
          />
          <div className="flex flex-1 flex-col justify-center py-2">
            <p className="flex items-center justify-center gap-1.5 text-base font-semibold text-gray-900">
              {t("topAltitudeValue", { m: Math.round(placeCard.altitudeM) })}
              <span
                role="img"
                aria-label={t("highestPlaceHowMeasured", {
                  source: placeCard.altitudeSource ?? "DEM",
                })}
                title={t("highestPlaceHowMeasured", {
                  source: placeCard.altitudeSource ?? "DEM",
                })}
                className="text-gray-400"
              >
                <Info className="h-3.5 w-3.5" aria-hidden />
              </span>
            </p>
            <p className="mt-1 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 text-sm text-gray-700">
              {placeCard.countryFlag && (
                <span className="leading-none" aria-hidden>
                  {placeCard.countryFlag}
                </span>
              )}
              {placeCard.countryLabel && <span>{placeCard.countryLabel}</span>}
              {placeCard.city && (
                <>
                  {placeCard.countryLabel && (
                    <span className="text-gray-400">·</span>
                  )}
                  <span>{placeCard.city}</span>
                </>
              )}
            </p>
            <p className="mt-0.5 flex flex-wrap items-baseline justify-center gap-x-1.5 text-center font-mono text-xs text-gray-500">
              <span>{formatLocationId(placeCard.id)}</span>
              {placeCard.code && (
                <>
                  <span className="text-gray-400">·</span>
                  <span className="break-all">{placeCard.code}</span>
                </>
              )}
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Link href={`/sbirka?loc=${placeCard.id}`} className={CHIP_PRIMARY}>
              {t("highestPlaceShowFinds", { count: placeCard.count })}
            </Link>
            <Link href={locationDetailHref(placeCard.id)} className={CHIP}>
              {t("highestPlaceOpenLocation")}
            </Link>
            <Link
              href={`/mapa?focus=${placeCard.id}`}
              className={CHIP}
              title={t("showOnMapTitle")}
            >
              <MapPin className="h-3.5 w-3.5" aria-hidden />
              {t("showOnMapLabel")}
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}

const CHIP =
  "inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-600 transition hover:border-brand-200 hover:text-brand-700 hover:shadow-sm";
const CHIP_PRIMARY =
  "inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm";

type T = ReturnType<typeof useTranslations<"Statistiky">>;
type TimeT = ReturnType<typeof useTranslations<"TimeSince">>;

/**
 * Card title with its toggle either underneath (`stacked`) or pinned to the
 * top-right corner (`corner`).
 *
 * `corner` costs no height at all — the control sits beside the title rather
 * than under it — which matters on the cards where the body is what should
 * fill the panel. It's absolute only from `sm` up; on a narrow screen it
 * flows under the title instead of overlapping it.
 */
function CardHeader({
  title,
  toggle,
  position = "stacked",
}: {
  title: string;
  toggle: React.ReactNode;
  position?: "stacked" | "corner";
}) {
  if (position === "corner") {
    // A row, not an absolutely-positioned overlay: the toggle is up to 180 px
    // wide and the narrow card's column only 364 px, so absolute positioning
    // put it straight over the end of the title. `flex-1` centres the title in
    // whatever space is left, and both stay on one line — no extra height.
    return (
      <div className="flex flex-col items-center gap-2 sm:flex-row sm:items-center">
        <h2 className="text-balance text-center text-sm font-semibold uppercase tracking-wide text-brand-700 sm:flex-1">
          {title}
        </h2>
        {toggle && <div className="shrink-0">{toggle}</div>}
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-2">
      <h2 className="text-center text-sm font-semibold uppercase tracking-wide text-brand-700">
        {title}
      </h2>
      {toggle}
    </div>
  );
}

/** Segmented control on `sm`+, native select below it — same trade-off as the
 *  Top 10 locations toggle, where four wrapped labels wrecked the header. */
function Toggle({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (next: string) => void;
  ariaLabel: string;
}) {
  return (
    <>
      <label className="sm:hidden">
        <span className="sr-only">{ariaLabel}</span>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-brand-700 shadow-sm"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <div
        role="radiogroup"
        aria-label={ariaLabel}
        className="hidden items-center gap-0.5 rounded-md border border-gray-200 bg-gray-50 p-0.5 sm:inline-flex"
      >
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={`rounded px-2.5 py-1 text-xs font-medium transition ${
              value === o.value
                ? "bg-white text-brand-700 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </>
  );
}

function FindBody({
  find,
  locale,
  t,
  tTime,
}: {
  find: FindHighlight;
  locale: string;
  t: T;
  tTime: TimeT;
}) {
  const date = find.foundAt ? new Date(find.foundAt) : null;
  return (
    <>
      <p className="text-center text-base font-semibold text-gray-900">
        {date ? formatDateTimeCs(date, locale) : t("missingDate")}
      </p>
      {date && (
        <p className="text-center text-xs text-gray-500">
          {formatTimeSinceCs(date, tTime)}
        </p>
      )}
    </>
  );
}

function FindButtons({ find, t }: { find: FindHighlight; t: T }) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      <Link href={`/sbirka/${find.id}`} className={CHIP_PRIMARY}>
        {t("openFind", { id: find.id })}
      </Link>
      {!find.isAnonymized && find.hasGps && (
        <Link
          href={`/mapa?find=${find.id}`}
          className={CHIP}
          aria-label={t("showFindOnMapAria", { id: find.id })}
          title={t("showOnMapTitle")}
        >
          <MapPin className="h-3.5 w-3.5" aria-hidden />
          {t("showOnMapLabel")}
        </Link>
      )}
    </div>
  );
}

/** One half of the merged first/last card. */
function FindHalf({
  caption,
  find,
  locale,
  t,
  tTime,
}: {
  caption: string;
  find: FindHighlight | null;
  locale: string;
  t: T;
  tTime: TimeT;
}) {
  if (!find) return <div />;
  return (
    <div className="flex flex-col rounded-lg border border-gray-100 bg-gray-50/60 p-3">
      <p className="text-center text-xs font-medium uppercase tracking-wide text-gray-500">
        {caption}
      </p>
      <div className="flex flex-1 flex-col justify-center py-2">
        <FindBody find={find} locale={locale} t={t} tTime={tTime} />
      </div>
      <FindButtons find={find} t={t} />
    </div>
  );
}
