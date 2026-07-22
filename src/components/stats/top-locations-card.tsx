"use client";

import { useState } from "react";
import { ExternalLink, EyeOff, ListIcon, MapPin, Sparkles } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  formatAreaM2,
  formatDensity,
  formatLocationId,
  locationDetailHref,
} from "@/lib/format";
import { CollapsibleSection } from "@/components/stats/collapsible-section";
import type {
  LocationDensityPoint,
  LocationPoint,
  LocationSessionPoint,
} from "@/lib/queries/stats";

type Mode = "count" | "density" | "sessions";

function toIntlLocale(locale: string): string {
  if (locale === "cs") return "cs-CZ";
  if (locale === "en") return "en-GB";
  return locale;
}

export function TopLocationsCard({
  byCount,
  byDensity,
  densityCuriosities,
  bySessions,
  avgCount,
  avgDensity,
  avgSessions,
}: {
  byCount: readonly LocationPoint[];
  byDensity: readonly LocationDensityPoint[];
  /** Sub-1m² micro-locations shown as a "curiosity" below the density
   *  ranking (excluded from it so they don't flatten the bars). */
  densityCuriosities: readonly LocationDensityPoint[];
  bySessions: readonly LocationSessionPoint[];
  /** Mean finds per location, shown beside the "by count" toggle. */
  avgCount: number;
  /** Mean density (clovers / 100 m²), shown beside the "by density"
   *  toggle. */
  avgDensity: number;
  /** Mean finds per session, shown beside the "by sessions" toggle. */
  avgSessions: number;
}) {
  const t = useTranslations("Statistiky");
  const locale = useLocale();
  const numFmt = new Intl.NumberFormat(toIntlLocale(locale));
  const avgFmt = new Intl.NumberFormat(toIntlLocale(locale), {
    maximumFractionDigits: 1,
  });
  const [mode, setMode] = useState<Mode>("count");

  const hasDensity = byDensity.length > 0;
  const hasSessions = bySessions.length > 0;
  const showToggle = hasDensity || hasSessions;
  // Fall back to "count" if the picked mode has no data (e.g. no polygons).
  const activeMode: Mode =
    (mode === "density" && !hasDensity) || (mode === "sessions" && !hasSessions)
      ? "count"
      : mode;

  const title =
    activeMode === "count"
      ? t("topLocationsHeading", { count: byCount.length })
      : activeMode === "density"
        ? t("topByDensityHeading", { count: byDensity.length })
        : t("topBySessionsHeading", { count: bySessions.length });
  const subtitle =
    activeMode === "count"
      ? t("topLocationsSubtitle")
      : activeMode === "density"
        ? t("topByDensitySubtitle")
        : t("topBySessionsSubtitle");
  const baselineTitle =
    activeMode === "count"
      ? t("topAvgCountTitle")
      : activeMode === "density"
        ? t("topAvgDensityTitle")
        : t("topAvgSessionsTitle");
  const baseline =
    activeMode === "count"
      ? t("topAvgCount", { avg: avgFmt.format(avgCount) })
      : activeMode === "density"
        ? t("topAvgDensity", { avg: formatDensity(avgDensity) })
        : t("topAvgSessions", { avg: avgFmt.format(avgSessions) });

  return (
    <CollapsibleSection
      storageKey="topLocations"
      id="top-locations"
      title={title}
      subtitle={subtitle}
    >
      <div className="mb-4 flex items-center justify-between gap-2">
        <p className="text-xs text-gray-500" title={baselineTitle}>
          {baseline}
        </p>
        {showToggle && (
          <ModeToggle
            mode={activeMode}
            onChange={setMode}
            hasDensity={hasDensity}
            hasSessions={hasSessions}
            t={t}
          />
        )}
      </div>
      {activeMode === "count" ? (
        <CountList rows={byCount} numFmt={numFmt} t={t} />
      ) : activeMode === "density" ? (
        <>
          <DensityList rows={byDensity} numFmt={numFmt} t={t} />
          {densityCuriosities.length > 0 && (
            <DensityCuriosities
              rows={densityCuriosities}
              numFmt={numFmt}
              t={t}
            />
          )}
        </>
      ) : (
        <SessionsList rows={bySessions} numFmt={numFmt} avgFmt={avgFmt} t={t} />
      )}
    </CollapsibleSection>
  );
}

type StatsT = ReturnType<typeof useTranslations<"Statistiky">>;

function ModeToggle({
  mode,
  onChange,
  hasDensity,
  hasSessions,
  t,
}: {
  mode: Mode;
  onChange: (next: Mode) => void;
  hasDensity: boolean;
  hasSessions: boolean;
  t: StatsT;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={t("topToggleAria")}
      className="inline-flex items-center gap-0.5 rounded-md border border-gray-200 bg-gray-50 p-0.5"
    >
      <ModeButton
        active={mode === "count"}
        onClick={() => onChange("count")}
        label={t("topToggleByCount")}
      />
      {hasDensity && (
        <ModeButton
          active={mode === "density"}
          onClick={() => onChange("density")}
          label={t("topToggleByDensity")}
        />
      )}
      {hasSessions && (
        <ModeButton
          active={mode === "sessions"}
          onClick={() => onChange("sessions")}
          label={t("topToggleBySessions")}
        />
      )}
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`rounded px-2.5 py-1 text-xs font-medium transition ${
        active
          ? "bg-white text-brand-700 shadow-sm"
          : "text-gray-600 hover:text-gray-900"
      }`}
    >
      {label}
    </button>
  );
}

function CountList({
  rows,
  numFmt,
  t,
}: {
  rows: readonly LocationPoint[];
  numFmt: Intl.NumberFormat;
  t: StatsT;
}) {
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0);
  return (
    <ol className="space-y-2">
      {rows.map((r, i) => (
        <Row
          key={r.id}
          rank={i + 1}
          id={r.id}
          code={r.code}
          name={r.name}
          isAnonymized={false}
          value={r.count}
          max={max}
          valueLabel={numFmt.format(r.count)}
          labelWidthClass="w-20"
          t={t}
        />
      ))}
    </ol>
  );
}

function DensityList({
  rows,
  numFmt,
  t,
}: {
  rows: readonly LocationDensityPoint[];
  numFmt: Intl.NumberFormat;
  t: StatsT;
}) {
  const max = rows.reduce((m, r) => Math.max(m, r.densityPer100m2), 0);
  return (
    <ol className="space-y-2">
      {rows.map((r, i) => (
        <Row
          key={r.id}
          rank={i + 1}
          id={r.id}
          code={r.code}
          name={r.name}
          isAnonymized={r.isAnonymized}
          value={r.densityPer100m2}
          max={max}
          valueLabel={formatDensity(r.densityPer100m2)}
          labelWidthClass="w-32"
          suffix={t("rowSuffixCountWithArea", {
            count: numFmt.format(r.count),
            area: formatAreaM2(r.areaM2),
          })}
          t={t}
        />
      ))}
    </ol>
  );
}

/**
 * "Kuriozita" callout below the density ranking: sub-1m² micro-locations
 * (e.g. a 15 cm radius spot) whose per-100m² density is so extreme it would
 * flatten every bar in the ranking. Shown without a bar — it's a fun fact,
 * not a rank — leading with the real curiosity ("N 🍀 on 0,07 m²") and the
 * absurd extrapolation in tow. Anon rows keep the same button policy as the
 * ranking (finds link only; detail/map would expose hidden GPS).
 */
function DensityCuriosities({
  rows,
  numFmt,
  t,
}: {
  rows: readonly LocationDensityPoint[];
  numFmt: Intl.NumberFormat;
  t: StatsT;
}) {
  return (
    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/70 p-3">
      <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-700">
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
        {t("densityCuriosityHeading")}
      </p>
      <p className="mt-1 text-xs text-amber-900/70">
        {t("densityCuriosityIntro")}
      </p>
      <ul className="mt-2.5 space-y-2">
        {rows.map((r) => (
          <li
            key={r.id}
            className="flex items-start gap-3 rounded-md border border-amber-100 bg-white/70 p-2.5"
          >
            <div className="min-w-0 flex-1">
              <Identity
                id={r.id}
                code={r.code}
                isAnonymized={r.isAnonymized}
                t={t}
              />
              <p className="mt-0.5 text-xs text-gray-600">
                {t("densityCuriosityValue", {
                  count: numFmt.format(r.count),
                  area: formatAreaM2(r.areaM2),
                  density: formatDensity(r.densityPer100m2),
                })}
              </p>
            </div>
            <div className="flex shrink-0 items-start gap-1">
              {!r.isAnonymized && <DetailButton id={r.id} t={t} />}
              <FindsButton id={r.id} t={t} />
              {!r.isAnonymized && <MapButton id={r.id} t={t} />}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SessionsList({
  rows,
  numFmt,
  avgFmt,
  t,
}: {
  rows: readonly LocationSessionPoint[];
  numFmt: Intl.NumberFormat;
  avgFmt: Intl.NumberFormat;
  t: StatsT;
}) {
  const max = rows.reduce((m, r) => Math.max(m, r.sessions), 0);
  return (
    <ol className="space-y-2">
      {rows.map((r, i) => (
        <Row
          key={r.id}
          rank={i + 1}
          id={r.id}
          code={r.code}
          name={r.name}
          isAnonymized={false}
          value={r.sessions}
          max={max}
          valueLabel={numFmt.format(r.sessions)}
          labelWidthClass="w-16"
          suffix={t("rowSuffixSessions", {
            avg: avgFmt.format(r.avgPerSession),
            count: numFmt.format(r.finds),
          })}
          t={t}
        />
      ))}
    </ol>
  );
}

function Row({
  rank,
  id,
  code,
  name,
  isAnonymized,
  value,
  max,
  valueLabel,
  labelWidthClass,
  suffix,
  t,
}: {
  rank: number;
  id: number;
  code: string | null;
  name: string | null;
  isAnonymized: boolean;
  value: number;
  max: number;
  valueLabel: string;
  labelWidthClass: string;
  suffix?: string;
  t: StatsT;
}) {
  const nameVisible =
    !isAnonymized && !!name && !!code && name !== code;
  const showSecondLine = nameVisible || !!suffix;
  return (
    <li className="space-y-2 rounded-md border border-gray-100 bg-gray-50 p-3">
      <div className="flex items-start gap-3">
        <Rank n={rank} />
        <div className="min-w-0 flex-1">
          <Identity id={id} code={code} isAnonymized={isAnonymized} t={t} />
          {showSecondLine && (
            <p className="mt-0.5 truncate text-xs text-gray-500">
              {nameVisible && <span title={name ?? undefined}>{name}</span>}
              {nameVisible && suffix && " "}
              {suffix && (
                <span>{nameVisible ? `(${suffix})` : suffix}</span>
              )}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-start gap-1">
          {/* Anon locations get only the "Ukázat 🍀" finds link — the finds
              self-anonymize on /sbirka. Detail + map would expose the hidden
              GPS / polygon, so they stay non-anon only. */}
          {!isAnonymized && <DetailButton id={id} t={t} />}
          <FindsButton id={id} t={t} />
          {!isAnonymized && <MapButton id={id} t={t} />}
        </div>
      </div>
      <Bar
        value={value}
        max={max}
        valueLabel={valueLabel}
        labelWidthClass={labelWidthClass}
      />
    </li>
  );
}

function Rank({ n }: { n: number }) {
  return (
    <span className="w-6 shrink-0 text-center font-mono text-sm font-semibold text-brand-700">
      {n}.
    </span>
  );
}

function Identity({
  id,
  code,
  isAnonymized,
  t,
}: {
  id: number;
  code: string | null;
  isAnonymized: boolean;
  t: StatsT;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      <span className="font-mono text-xs text-gray-500">
        {formatLocationId(id)}
      </span>
      {/* The code is public even for anon locations (owner's call); only the
          map-derived name is withheld. Anon rows keep the eye-off badge so
          it's clear the spot is otherwise private. */}
      <span className="truncate text-sm font-semibold text-gray-900">
        {code ?? ""}
      </span>
      {isAnonymized && (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-purple-700">
          <EyeOff className="h-3 w-3" aria-hidden />
          {t("anonymizedLocation")}
        </span>
      )}
    </div>
  );
}

function Bar({
  value,
  max,
  valueLabel,
  labelWidthClass,
}: {
  value: number;
  max: number;
  valueLabel: string;
  labelWidthClass: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200">
        <div
          className="h-full rounded-full bg-brand-500"
          style={{ width: max > 0 ? `${(value / max) * 100}%` : "0%" }}
        />
      </div>
      <span
        className={`shrink-0 whitespace-nowrap text-right font-mono text-xs tabular-nums text-gray-600 ${labelWidthClass}`}
      >
        {valueLabel}
      </span>
    </div>
  );
}

function MapButton({ id, t }: { id: number; t: StatsT }) {
  return (
    <Link
      href={`/mapa?focus=${id}`}
      aria-label={t("rowMapAria")}
      title={t("rowMapAria")}
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm"
    >
      <MapPin className="h-3.5 w-3.5" aria-hidden />
      <span className="hidden sm:inline">{t("rowMap")}</span>
    </Link>
  );
}

function FindsButton({ id, t }: { id: number; t: StatsT }) {
  return (
    <Link
      href={`/sbirka?loc=${id}`}
      aria-label={t("rowFindsAria")}
      title={t("rowFindsAria")}
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm"
    >
      <ListIcon className="h-3.5 w-3.5" aria-hidden />
      <span className="hidden sm:inline">{t("rowFinds")}</span>
    </Link>
  );
}

function DetailButton({ id, t }: { id: number; t: StatsT }) {
  return (
    <Link
      href={locationDetailHref(id)}
      aria-label={t("rowDetailAria")}
      title={t("rowDetailAria")}
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm"
    >
      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
      <span className="hidden sm:inline">{t("rowDetail")}</span>
    </Link>
  );
}
