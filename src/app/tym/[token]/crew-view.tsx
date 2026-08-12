"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { Check, Copy, Maximize2, MapPin, Search } from "lucide-react";
import {
  DROP_STATUS_COLOR,
  DROP_STATUS_LABEL,
  DROP_STATUS_ORDER,
} from "@/lib/admin/dropVocab";
import type { BoundaryGeometry } from "@/lib/admin/dropBoundary";
import type { DropStatus } from "@/generated/prisma/enums";
import type { CrewPoint } from "./crew-map";

/** Leaflet reads `window` at module load, same as every other map here. */
const CrewMap = dynamic(() => import("./crew-map").then((m) => m.CrewMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-[32rem] max-h-[70vh] w-full items-center justify-center rounded-xl bg-gray-100 text-xs text-gray-400">
      Načítám mapu…
    </div>
  ),
});

export interface CrewCard extends CrewPoint {
  scans: number;
  foundAt: string | null;
}

/**
 * What the crew sees once the password is in: the area on a map, and the
 * same cards as a list underneath.
 *
 * The list is not decoration — in the field the map is a phone screen with
 * a dozen markers on top of each other, and "which of these have I already
 * done" is answered faster by reading a list than by tapping pins. Both
 * halves share one selection.
 */
export function CrewView({
  areaName,
  campaignName,
  center,
  zoom,
  radiusM,
  boundary,
  cards,
}: {
  areaName: string;
  campaignName: string;
  center: [number, number];
  zoom: number;
  radiusM: number | null;
  boundary: BoundaryGeometry | null;
  cards: CrewCard[];
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [fitToken, setFitToken] = useState(0);
  const [statuses, setStatuses] = useState<Set<DropStatus>>(new Set());
  const [query, setQuery] = useState("");

  const counts = useMemo(() => {
    const m = new Map<DropStatus, number>();
    for (const c of cards) m.set(c.status, (m.get(c.status) ?? 0) + 1);
    return m;
  }, [cards]);

  const visible = useMemo(() => {
    const q = query.trim().replace(/^#/, "");
    return cards.filter((c) => {
      if (statuses.size > 0 && !statuses.has(c.status)) return false;
      if (q && !String(c.findId).includes(q)) return false;
      return true;
    });
  }, [cards, statuses, query]);

  const toggleStatus = (s: DropStatus) =>
    setStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-4">
        <p className="text-xs uppercase tracking-wide text-gray-400">
          {campaignName}
        </p>
        <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900">
          <MapPin className="h-5 w-5 text-brand-600" aria-hidden />
          {areaName}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {cards.length}{" "}
          {cards.length === 1
            ? "kartička s pozicí"
            : cards.length < 5
              ? "kartičky s pozicí"
              : "kartiček s pozicí"}{" "}
          · jen pro tým, prosím nikam nesdílej
        </p>
      </header>

      {/* --------------------------------------------------------- filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {DROP_STATUS_ORDER.filter((s) => (counts.get(s) ?? 0) > 0).map((s) => {
          const on = statuses.has(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() => toggleStatus(s)}
              aria-pressed={on}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                on
                  ? "border-gray-900 bg-gray-900 text-white"
                  : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: DROP_STATUS_COLOR[s] }}
                aria-hidden
              />
              {DROP_STATUS_LABEL[s]}
              <span className="tabular-nums opacity-70">
                {counts.get(s) ?? 0}
              </span>
            </button>
          );
        })}
        <label className="relative ml-auto">
          <span className="sr-only">Hledat číslo čtyřlístku</span>
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"
            aria-hidden
          />
          <input
            inputMode="numeric"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="#číslo"
            className="w-32 rounded-full border border-gray-300 py-1.5 pl-8 pr-3 text-xs text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
          />
        </label>
        <button
          type="button"
          onClick={() => setFitToken((t) => t + 1)}
          className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
        >
          <Maximize2 className="h-3.5 w-3.5" aria-hidden />
          Celá oblast
        </button>
      </div>

      <CrewMap
        center={center}
        zoom={zoom}
        radiusM={radiusM}
        boundary={boundary}
        points={visible}
        selectedId={selected}
        fitToken={fitToken}
        onSelect={setSelected}
      />

      {/* ------------------------------------------------------------ list */}
      <ul className="mt-4 space-y-2">
        {visible.map((c) => (
          <CrewRow
            key={c.id}
            card={c}
            selected={c.id === selected}
            onSelect={() => setSelected(c.id)}
          />
        ))}
        {visible.length === 0 && (
          <li className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-6 text-center text-xs text-gray-500">
            Nic neodpovídá filtru.
          </li>
        )}
      </ul>
    </main>
  );
}

function CrewRow({
  card,
  selected,
  onSelect,
}: {
  card: CrewCard;
  selected: boolean;
  onSelect: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const coords = `${card.lat.toFixed(6)}, ${card.lng.toFixed(6)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(coords);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (insecure context, permissions) — the number is
      // right there to read, so this fails quietly rather than alarming.
    }
  };

  return (
    <li
      className={`rounded-lg border p-3 transition ${
        selected
          ? "border-gray-900 bg-white shadow-sm"
          : "border-gray-200 bg-white"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          onClick={onSelect}
          className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 text-left"
        >
          <span
            className="h-3 w-3 shrink-0 rounded-full"
            style={{ backgroundColor: DROP_STATUS_COLOR[card.status] }}
            aria-hidden
          />
          <span className="font-semibold text-gray-900">🍀 #{card.findId}</span>
          <span className="text-xs text-gray-500">
            {DROP_STATUS_LABEL[card.status]}
            {card.placedBy && <> · {card.placedBy}</>}
            {card.scans > 0 && <> · {card.scans}× sken</>}
            {card.foundAt && <> · {card.foundAt}</>}
          </span>
        </button>
        {/* Full width on a phone: squeezed next to the label it wrapped the
            coordinates onto three lines and became unreadable — which is
            the one thing the crew is actually here to read. */}
        <button
          type="button"
          onClick={copy}
          className="inline-flex w-full shrink-0 items-center justify-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 font-mono text-[11px] text-gray-600 transition hover:bg-gray-50 sm:w-auto sm:justify-start sm:py-1"
          title="Zkopírovat souřadnice"
        >
          {copied ? (
            <Check className="h-3 w-3 text-emerald-600" aria-hidden />
          ) : (
            <Copy className="h-3 w-3" aria-hidden />
          )}
          {coords}
        </button>
      </div>
      {card.teamNote && (
        <p className="mt-2 whitespace-pre-line rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
          {card.teamNote}
        </p>
      )}
    </li>
  );
}
