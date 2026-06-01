"use client";

import { useState } from "react";
import { ExternalLink, EyeOff, MapPin } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  formatAreaM2,
  formatDensityPer100m2,
  formatLocationId,
  locationDetailHref,
} from "@/lib/format";
import { CollapsibleSection } from "@/components/stats/collapsible-section";
import type {
  LocationDensityPoint,
  LocationPoint,
} from "@/lib/queries/stats";

type Mode = "count" | "density";

function toIntlLocale(locale: string): string {
  if (locale === "cs") return "cs-CZ";
  if (locale === "en") return "en-GB";
  return locale;
}

export function TopLocationsCard({
  byCount,
  byDensity,
}: {
  byCount: readonly LocationPoint[];
  byDensity: readonly LocationDensityPoint[];
}) {
  const t = useTranslations("Statistiky");
  const locale = useLocale();
  const numFmt = new Intl.NumberFormat(toIntlLocale(locale));
  const [mode, setMode] = useState<Mode>("count");

  const hasDensity = byDensity.length > 0;
  const showToggle = hasDensity;
  const activeMode: Mode = !hasDensity ? "count" : mode;

  return (
    <CollapsibleSection
      title={
        activeMode === "count"
          ? t("topLocationsHeading", { count: byCount.length })
          : t("topByDensityHeading", { count: byDensity.length })
      }
      subtitle={
        activeMode === "count"
          ? t("topLocationsSubtitle")
          : t("topByDensitySubtitle")
      }
    >
      {showToggle && (
        <div className="mb-4 flex justify-end">
          <ModeToggle mode={activeMode} onChange={setMode} t={t} />
        </div>
      )}
      {activeMode === "count" ? (
        <CountList rows={byCount} numFmt={numFmt} t={t} />
      ) : (
        <DensityList rows={byDensity} numFmt={numFmt} t={t} />
      )}
    </CollapsibleSection>
  );
}

type StatsT = ReturnType<typeof useTranslations<"Statistiky">>;

function ModeToggle({
  mode,
  onChange,
  t,
}: {
  mode: Mode;
  onChange: (next: Mode) => void;
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
      <ModeButton
        active={mode === "density"}
        onClick={() => onChange("density")}
        label={t("topToggleByDensity")}
      />
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
          valueLabel={formatDensityPer100m2(r.densityPer100m2)}
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
        {!isAnonymized && (
          <div className="flex shrink-0 items-start gap-1">
            <DetailButton id={id} t={t} />
            <MapButton id={id} t={t} />
          </div>
        )}
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
  if (isAnonymized) {
    return (
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-xs text-gray-500">
          {formatLocationId(id)}
        </span>
        <span className="inline-flex items-center gap-1 text-sm font-semibold text-purple-700">
          <EyeOff className="h-3 w-3" aria-hidden />
          {t("anonymizedLocation")}
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      <span className="font-mono text-xs text-gray-500">
        {formatLocationId(id)}
      </span>
      <span className="truncate text-sm font-semibold text-gray-900">
        {code ?? ""}
      </span>
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
