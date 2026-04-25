"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { LocationListItem } from "@/lib/queries/locations";
import { STATE_BADGE, STATE_LABELS } from "@/lib/stateLabels";
import { formatLocationId } from "@/lib/format";
import { formatCount, FINDS } from "@/lib/format";

export function LocationListRow({ location }: { location: LocationListItem }) {
  const [open, setOpen] = useState(false);

  const subtitle = [location.cadastralArea, location.locationType]
    .filter(Boolean)
    .join(" · ");

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-stretch gap-4 p-3 text-left transition hover:bg-brand-50"
      >
        {location.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={location.thumbnailUrl}
            alt=""
            aria-hidden
            loading="lazy"
            decoding="async"
            className="h-20 w-20 shrink-0 rounded-md border border-gray-200 object-cover sm:h-24 sm:w-24"
          />
        ) : (
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md border border-dashed border-gray-300 bg-gray-50 text-2xl text-gray-300 sm:h-24 sm:w-24">
            🍀
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col justify-between gap-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-mono text-xs text-gray-500">
              {formatLocationId(location.id)}
            </span>
            <span
              className="truncate text-sm font-semibold text-gray-900"
              title={location.code}
            >
              {location.code}
            </span>
            {location.displayName && location.displayName !== location.code && (
              <span
                className="truncate text-sm text-gray-500"
                title={location.displayName}
              >
                ({location.displayName})
              </span>
            )}
          </div>

          {subtitle && (
            <p className="truncate text-xs text-gray-500">{subtitle}</p>
          )}

          <p className="text-sm font-medium text-brand-700">
            {formatCount(location.stats.total, FINDS)}
            {location.stats.anonymized > 0 && (
              <span className="ml-2 text-xs text-purple-600">
                ({location.stats.anonymized} anonymizovaných)
              </span>
            )}
          </p>
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
      </button>

      {open && <StatsPanel location={location} />}
    </div>
  );
}

function StatsPanel({ location }: { location: LocationListItem }) {
  const { stats } = location;
  const yearMax = stats.yearly.reduce((m, y) => Math.max(m, y.count), 0);
  const stateMax = stats.states.reduce((m, s) => Math.max(m, s.count), 0);

  return (
    <div className="border-t border-gray-200 bg-gray-50 px-3 py-4 sm:px-6">
      {stats.total === 0 ? (
        <p className="text-sm text-gray-500">
          Pro tuto lokalitu zatím nejsou žádné nálezy.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <SummaryRow
              total={stats.total}
              anonymized={stats.anonymized}
              firstYear={stats.firstYear}
              lastYear={stats.lastYear}
            />

            {stats.states.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Stavy nálezů
                </h3>
                <ul className="space-y-1.5">
                  {stats.states.map((s) => (
                    <li key={s.state} className="flex items-center gap-2">
                      <span
                        className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${STATE_BADGE[s.state]}`}
                      >
                        {STATE_LABELS[s.state]}
                      </span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-200">
                        <div
                          className="h-full rounded-full bg-brand-500"
                          style={{
                            width: stateMax > 0
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

          <div className="space-y-3">
            {stats.yearly.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Nálezy podle let
                </h3>
                <ul className="space-y-1.5">
                  {stats.yearly.map((y) => (
                    <li key={y.year} className="flex items-center gap-2">
                      <span className="w-12 shrink-0 font-mono text-xs text-gray-600">
                        {y.year}
                      </span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-200">
                        <div
                          className="h-full rounded-full bg-brand-500"
                          style={{
                            width: yearMax > 0
                              ? `${(y.count / yearMax) * 100}%`
                              : "0%",
                          }}
                        />
                      </div>
                      <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums text-gray-600">
                        {y.count}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {stats.firstFindId !== null && (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  První nález
                </h3>
                <Link
                  href={`/sbirka/${stats.firstFindId}`}
                  className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm"
                >
                  #{stats.firstFindId} →
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryRow({
  total,
  anonymized,
  firstYear,
  lastYear,
}: {
  total: number;
  anonymized: number;
  firstYear: number | null;
  lastYear: number | null;
}) {
  return (
    <dl className="grid grid-cols-2 gap-3 text-sm">
      <Stat label="Celkem nálezů" value={String(total)} />
      <Stat
        label="Anonymizovaných"
        value={anonymized > 0 ? String(anonymized) : "—"}
      />
      <Stat
        label="Rozsah let"
        value={
          firstYear !== null && lastYear !== null
            ? firstYear === lastYear
              ? String(firstYear)
              : `${firstYear}–${lastYear}`
            : "—"
        }
      />
    </dl>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-gray-200 bg-white p-3">
      <dt className="text-xs font-medium text-gray-500">{label}</dt>
      <dd className="mt-1 text-lg font-semibold text-gray-900">{value}</dd>
    </div>
  );
}
