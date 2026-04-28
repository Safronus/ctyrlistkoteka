"use client";

import Link from "next/link";
import { useState } from "react";
import { EyeOff, MapPin } from "lucide-react";
import {
  formatAreaM2,
  formatDensityPer100m2,
  formatLocationId,
} from "@/lib/format";
import type {
  LocationDensityPoint,
  LocationPoint,
} from "@/lib/queries/stats";

type Mode = "count" | "density";

/**
 * Leaderboard of locations on /statistiky with a Mode toggle that flips
 * between the absolute "TOP by count" view and the per-area "TOP by
 * density" view (clovers per 100 m²). Both lists arrive precomputed
 * from the SSR stats query; the toggle is purely presentational.
 *
 * The two views answer different questions about the same dataset:
 * `count` rewards the busiest places; `density` rewards small plots
 * that punch above their weight. Showing them as alternatives in the
 * same card (instead of two separate cards) keeps the page short
 * without losing the comparison.
 */
export function TopLocationsCard({
  byCount,
  byDensity,
}: {
  byCount: readonly LocationPoint[];
  byDensity: readonly LocationDensityPoint[];
}) {
  const [mode, setMode] = useState<Mode>("count");

  const hasDensity = byDensity.length > 0;
  // Fall back to count-only when no location qualifies for the density
  // view (e.g. no polygons recorded yet, or the 10-find floor wipes
  // every candidate). Hides the toggle entirely so the empty pill
  // doesn't confuse the visitor.
  const showToggle = hasDensity;
  const activeMode: Mode = !hasDensity ? "count" : mode;

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            {activeMode === "count"
              ? `TOP ${byCount.length} lokalit`
              : `TOP ${byDensity.length} dle hustoty`}
          </h2>
          <p className="text-sm text-gray-500">
            {activeMode === "count"
              ? "Nejpilnější místa nálezů"
              : "Nejvíc čtyřlístků na 100 m² polygonu (≥ 10 nálezů)"}
          </p>
        </div>
        {showToggle && (
          <ModeToggle mode={activeMode} onChange={setMode} />
        )}
      </header>
      {activeMode === "count" ? (
        <CountList rows={byCount} />
      ) : (
        <DensityList rows={byDensity} />
      )}
    </section>
  );
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: Mode;
  onChange: (next: Mode) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Řazení žebříčku lokalit"
      className="inline-flex items-center gap-0.5 rounded-md border border-gray-200 bg-gray-50 p-0.5"
    >
      <ModeButton
        active={mode === "count"}
        onClick={() => onChange("count")}
        label="Podle počtu"
      />
      <ModeButton
        active={mode === "density"}
        onClick={() => onChange("density")}
        label="Podle hustoty"
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

function CountList({ rows }: { rows: readonly LocationPoint[] }) {
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0);
  return (
    <ol className="space-y-2">
      {rows.map((r, i) => (
        <li
          key={r.id}
          className="flex items-center gap-3 rounded-md border border-gray-100 bg-gray-50 p-3"
        >
          <Rank n={i + 1} />
          <div className="min-w-0 flex-1">
            <Identity id={r.id} code={r.code} name={r.name} />
            <Bar
              value={r.count}
              max={max}
              valueLabel={r.count.toLocaleString("cs-CZ")}
            />
          </div>
          <MapButton id={r.id} />
        </li>
      ))}
    </ol>
  );
}

function DensityList({ rows }: { rows: readonly LocationDensityPoint[] }) {
  const max = rows.reduce((m, r) => Math.max(m, r.densityPer100m2), 0);
  return (
    <ol className="space-y-2">
      {rows.map((r, i) => (
        <li
          key={r.id}
          className="flex items-center gap-3 rounded-md border border-gray-100 bg-gray-50 p-3"
        >
          <Rank n={i + 1} />
          <div className="min-w-0 flex-1">
            <Identity
              id={r.id}
              code={r.code}
              name={r.name}
              isAnonymized={r.isAnonymized}
            />
            <p className="mt-0.5 text-[11px] text-gray-500">
              {r.count.toLocaleString("cs-CZ")} čtyřlístků ·{" "}
              {formatAreaM2(r.areaM2)}
            </p>
            <Bar
              value={r.densityPer100m2}
              max={max}
              valueLabel={formatDensityPer100m2(r.densityPer100m2)}
            />
          </div>
          {!r.isAnonymized && <MapButton id={r.id} />}
        </li>
      ))}
    </ol>
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
  name,
  isAnonymized = false,
}: {
  id: number;
  code: string | null;
  name: string | null;
  isAnonymized?: boolean;
}) {
  if (isAnonymized) {
    return (
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-xs text-gray-500">
          {formatLocationId(id)}
        </span>
        <span className="inline-flex items-center gap-1 text-sm font-semibold text-purple-700">
          <EyeOff className="h-3 w-3" aria-hidden />
          Anonymizovaná lokalita
        </span>
      </div>
    );
  }
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-xs text-gray-500">
          {formatLocationId(id)}
        </span>
        <span className="truncate text-sm font-semibold text-gray-900">
          {code ?? ""}
        </span>
      </div>
      {name && code && name !== code && (
        <p className="truncate text-xs text-gray-500" title={name}>
          {name}
        </p>
      )}
    </>
  );
}

function Bar({
  value,
  max,
  valueLabel,
}: {
  value: number;
  max: number;
  valueLabel: string;
}) {
  return (
    <div className="mt-1 flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200">
        <div
          className="h-full rounded-full bg-brand-500"
          style={{ width: max > 0 ? `${(value / max) * 100}%` : "0%" }}
        />
      </div>
      <span className="w-24 shrink-0 text-right font-mono text-xs tabular-nums text-gray-600">
        {valueLabel}
      </span>
    </div>
  );
}

function MapButton({ id }: { id: number }) {
  return (
    <Link
      href={`/mapa?focus=${id}`}
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm"
    >
      <MapPin className="h-3.5 w-3.5" aria-hidden />
      <span className="hidden sm:inline">Mapa</span>
    </Link>
  );
}
