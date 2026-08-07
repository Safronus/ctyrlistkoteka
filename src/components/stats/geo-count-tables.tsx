"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";

/**
 * The "by country" / "top cities" pair, switchable between counting FINDS and
 * counting LOCATIONS.
 *
 * No bars. One trip dominates the find counts by two orders of magnitude
 * (Ratiboř ~22 000 against Prague's 14), so a bar chart drew one full row and
 * nine empty ones — the number carries the information on its own. Counting
 * locations instead is the more even, and often more interesting, view: it
 * says where you've been rather than how lucky one field was.
 */

export interface GeoRow {
  key: string;
  label: string;
  count: number;
  /** Flag emoji for country rows; decorative, the label names the country. */
  flag?: string | null;
}

export function GeoCountTables({
  countriesByFinds,
  citiesByFinds,
  countriesByLocations,
  citiesByLocations,
  cityMaxRows = 10,
}: {
  countriesByFinds: readonly GeoRow[];
  citiesByFinds: readonly GeoRow[];
  countriesByLocations: readonly GeoRow[];
  citiesByLocations: readonly GeoRow[];
  cityMaxRows?: number;
}) {
  // Strings are resolved here rather than handed down from the server page:
  // one of them needed a count interpolated, and passing a formatter function
  // across the server/client boundary isn't serialisable — React throws
  // "Functions cannot be passed directly to Client Components".
  const t = useTranslations("Statistiky");
  const locale = useLocale();
  const numFmt = new Intl.NumberFormat(
    locale === "cs" ? "cs-CZ" : locale === "en" ? "en-GB" : locale,
  );
  const [byLocations, setByLocations] = useState(false);
  const countries = byLocations ? countriesByLocations : countriesByFinds;
  const cities = byLocations ? citiesByLocations : citiesByFinds;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <div
          role="radiogroup"
          aria-label={t("geoCountToggleAria")}
          className="inline-flex items-center gap-0.5 rounded-md border border-gray-200 bg-gray-50 p-0.5"
        >
          {[
            { on: false, label: t("geoCountByFinds") },
            { on: true, label: t("geoCountByLocations") },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              role="radio"
              aria-checked={byLocations === o.on}
              onClick={() => setByLocations(o.on)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                byLocations === o.on
                  ? "bg-white text-brand-700 shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Table
          title={t("geoTopCountries")}
          rows={countries}
          empty={t("noData")}
          numFmt={numFmt}
        />
        <Table
          title={t("geoTopCities")}
          rows={cities}
          maxRows={cityMaxRows}
          more={(n) => t("moreRows", { count: n })}
          empty={t("noData")}
          numFmt={numFmt}
        />
      </div>
    </div>
  );
}

function Table({
  title,
  rows,
  maxRows,
  more,
  empty,
  numFmt,
}: {
  title: string;
  rows: readonly GeoRow[];
  maxRows?: number;
  more?: (count: number) => string;
  empty: string;
  numFmt: Intl.NumberFormat;
}) {
  const visible = maxRows ? rows.slice(0, maxRows) : rows;
  const hidden = maxRows ? rows.length - visible.length : 0;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-brand-700">
        {title}
      </h3>
      {visible.length === 0 ? (
        <p className="text-sm text-gray-500">{empty}</p>
      ) : (
        <ol className="space-y-1.5">
          {visible.map((r, i) => (
            <li key={r.key} className="flex items-baseline gap-3">
              <span className="w-6 shrink-0 text-right font-mono text-xs text-gray-500">
                {i + 1}.
              </span>
              {r.flag && (
                <span className="shrink-0 text-base leading-none" aria-hidden>
                  {r.flag}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-sm text-gray-900">
                {r.label}
              </span>
              <span className="shrink-0 font-mono text-sm tabular-nums text-gray-700">
                {numFmt.format(r.count)}
              </span>
            </li>
          ))}
        </ol>
      )}
      {hidden > 0 && more && (
        <p className="mt-2 text-xs text-gray-500">{more(hidden)}</p>
      )}
    </div>
  );
}
