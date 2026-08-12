"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  Maximize2,
  MapPin,
  QrCode,
  Search,
} from "lucide-react";
import {
  DROP_STATUS_COLOR,
  DROP_STATUS_LABEL,
  DROP_STATUS_ORDER,
} from "@/lib/admin/dropVocab";
import type { BoundaryGeometry } from "@/lib/admin/dropBoundary";
import type { DropStatus } from "@/generated/prisma/enums";
import { NextSyncCountdown } from "@/components/drops/next-sync-countdown";
import type { CrewPoint } from "./crew-map";

/** Leaflet reads `window` at module load, same as every other map here. */
const CrewMap = dynamic(() => import("./crew-map").then((m) => m.CrewMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[20rem] w-full items-center justify-center bg-gray-100 text-xs text-gray-400">
      Načítám mapu…
    </div>
  ),
});

export interface CrewCard extends Omit<CrewPoint, "lat" | "lng"> {
  /** Belongs to the area this link opens — only those have a place. */
  mine: boolean;
  lat: number | null;
  lng: number | null;
  /** Which area it belongs to, for the cards from elsewhere in the wave. */
  areaLabel: string | null;
  scans: number;
  foundAt: string | null;
  landingUrl: string;
  heading: string;
  body: string;
}

export interface SheetStatus {
  mode: boolean;
  syncedAt: string | null;
  changedAt: string | null;
  error: string | null;
}

/**
 * What the crew sees once the password is in: the area on a map, and the
 * whole wave as a list beside it.
 *
 * Read-only throughout — there is not one control here that writes. The
 * list is not decoration: in the field the map is a phone screen with a
 * dozen markers on top of each other, and "which of these have I already
 * done" is answered faster by reading a list than by tapping pins.
 *
 * Cards from other areas are listed too (a number gets looked up more
 * often than a position) but carry no coordinates and never reach the
 * map — one link must not give away another area's hiding places.
 */
export function CrewView({
  token,
  areaName,
  campaignName,
  center,
  zoom,
  radiusM,
  boundary,
  cards,
  sheet,
}: {
  token: string;
  areaName: string;
  campaignName: string;
  center: [number, number];
  zoom: number;
  radiusM: number | null;
  boundary: BoundaryGeometry | null;
  cards: CrewCard[];
  sheet: SheetStatus;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [fitToken, setFitToken] = useState(0);
  const [statuses, setStatuses] = useState<Set<DropStatus>>(new Set());
  const [query, setQuery] = useState("");
  const [showQr, setShowQr] = useState(false);
  const [onlyMine, setOnlyMine] = useState(true);

  const mine = useMemo(() => cards.filter((c) => c.mine), [cards]);

  const stats = useMemo(() => {
    const byStatus = new Map<DropStatus, number>();
    let scans = 0;
    let found = 0;
    for (const c of mine) {
      byStatus.set(c.status, (byStatus.get(c.status) ?? 0) + 1);
      scans += c.scans;
      if (c.foundAt) found += 1;
    }
    return {
      byStatus,
      scans,
      found,
      placed: mine.filter((c) => c.lat !== null).length,
    };
  }, [mine]);

  const visible = useMemo(() => {
    const q = query.trim().replace(/^#/, "");
    return cards.filter((c) => {
      if (onlyMine && !c.mine) return false;
      if (statuses.size > 0 && !statuses.has(c.status)) return false;
      if (q && !String(c.findId).includes(q)) return false;
      return true;
    });
  }, [cards, statuses, query, onlyMine]);

  // Only placed cards of THIS area are drawn; the filter follows the list
  // so hiding a status hides its pins too.
  const points = useMemo(
    () =>
      visible
        .filter((c) => c.mine && c.lat !== null && c.lng !== null)
        .map((c) => ({ ...c, lat: c.lat!, lng: c.lng! })),
    [visible],
  );

  const toggleStatus = (s: DropStatus) =>
    setStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  return (
    <div className="flex min-h-screen flex-col lg:h-screen lg:overflow-hidden">
      {/* ------------------------------------------------------- header */}
      <header className="shrink-0 border-b border-gray-200 bg-white px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="flex items-center gap-2 text-lg font-bold text-gray-900">
            <MapPin className="h-5 w-5 text-brand-600" aria-hidden />
            {areaName}
          </h1>
          <p className="text-xs uppercase tracking-wide text-gray-400">
            {campaignName}
          </p>
          <p className="ml-auto text-[11px] text-gray-400">
            Jen pro tým — odkaz ani heslo nikam nepřeposílej.
          </p>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
          <span>
            <strong className="font-mono tabular-nums text-gray-900">
              {stats.placed}/{mine.length}
            </strong>{" "}
            s pozicí
          </span>
          <span>
            <strong className="font-mono tabular-nums text-emerald-700">
              {stats.found}
            </strong>{" "}
            nalezených
          </span>
          <span>
            <strong className="font-mono tabular-nums text-gray-900">
              {stats.scans}
            </strong>{" "}
            naskenování
          </span>
          {sheet.mode && (
            <>
              <span className="hidden text-gray-300 sm:inline">·</span>
              <span>
                Tabulka:{" "}
                <strong className="text-gray-800">
                  {sheet.changedAt
                    ? `naposledy se změnila ${fmtWhen(sheet.changedAt)}`
                    : "beze změn"}
                </strong>
              </span>
              <NextSyncCountdown syncedAt={sheet.syncedAt} />
              {sheet.error && (
                <span className="text-amber-700">
                  Poslední kontrola hlásí chybu — dej vědět majiteli.
                </span>
              )}
            </>
          )}
        </div>
      </header>

      {/* ------------------------------------------ map + list, side by side */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative h-[55vh] shrink-0 lg:h-auto lg:min-h-0 lg:flex-1">
          <CrewMap
            center={center}
            zoom={zoom}
            radiusM={radiusM}
            boundary={boundary}
            points={points}
            selectedId={selected}
            fitToken={fitToken}
            onSelect={setSelected}
          />
          <button
            type="button"
            onClick={() => setFitToken((t) => t + 1)}
            className="absolute right-3 top-3 z-[500] inline-flex items-center gap-1.5 rounded-full border border-gray-300 bg-white/95 px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition hover:bg-white"
          >
            <Maximize2 className="h-3.5 w-3.5" aria-hidden />
            Celá oblast
          </button>
        </div>

        <div className="flex min-h-0 w-full flex-col border-t border-gray-200 bg-white lg:w-[26rem] lg:border-l lg:border-t-0">
          {/* ----------------------------------------------------- filters */}
          <div className="shrink-0 space-y-2 border-b border-gray-100 p-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {DROP_STATUS_ORDER.filter(
                (s) => (stats.byStatus.get(s) ?? 0) > 0 || statuses.has(s),
              ).map((s) => {
                const on = statuses.has(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleStatus(s)}
                    aria-pressed={on}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                      on
                        ? "border-gray-900 bg-gray-900 text-white"
                        : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: DROP_STATUS_COLOR[s] }}
                      aria-hidden
                    />
                    {DROP_STATUS_LABEL[s]}
                    <span className="tabular-nums opacity-70">
                      {stats.byStatus.get(s) ?? 0}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <label className="relative flex-1">
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
                  className="w-full rounded-full border border-gray-300 py-1.5 pl-8 pr-3 text-xs text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
                />
              </label>
              <button
                type="button"
                onClick={() => setShowQr((v) => !v)}
                aria-pressed={showQr}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-medium transition ${
                  showQr
                    ? "border-gray-900 bg-gray-900 text-white"
                    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                <QrCode className="h-3.5 w-3.5" aria-hidden />
                QR
              </button>
              <button
                type="button"
                onClick={() => setOnlyMine((v) => !v)}
                aria-pressed={!onlyMine}
                title="Zbytek sady je jen k nahlédnutí — bez míst úkrytů"
                className={`inline-flex items-center rounded-full border px-2.5 py-1.5 text-[11px] font-medium transition ${
                  onlyMine
                    ? "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                    : "border-gray-900 bg-gray-900 text-white"
                }`}
              >
                {onlyMine ? "Celá sada" : `Jen ${areaName}`}
              </button>
            </div>
          </div>

          {/* -------------------------------------------------------- list */}
          <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {visible.map((c) => (
              <CrewRow
                key={c.id}
                token={token}
                card={c}
                showQr={showQr}
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
        </div>
      </div>
    </div>
  );
}

function CrewRow({
  token,
  card,
  showQr,
  selected,
  onSelect,
}: {
  token: string;
  card: CrewCard;
  showQr: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [openText, setOpenText] = useState(false);
  const coords =
    card.lat !== null && card.lng !== null
      ? `${card.lat.toFixed(6)}, ${card.lng.toFixed(6)}`
      : null;

  const copy = async () => {
    if (!coords) return;
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
      className={`rounded-lg border p-2.5 transition ${
        selected ? "border-gray-900 shadow-sm" : "border-gray-200"
      } ${card.mine ? "bg-white" : "bg-gray-50"}`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <button
          type="button"
          onClick={onSelect}
          className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 text-left"
        >
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: DROP_STATUS_COLOR[card.status] }}
            aria-hidden
          />
          <span className="text-sm font-semibold text-gray-900">
            🍀 #{card.findId}
          </span>
          <span className="text-[11px] text-gray-500">
            {DROP_STATUS_LABEL[card.status]}
            {card.placedBy && <> · {card.placedBy}</>}
            {card.scans > 0 && <> · {card.scans}× sken</>}
            {card.foundAt && <> · {card.foundAt}</>}
          </span>
        </button>
        <a
          href={card.landingUrl}
          target="_blank"
          rel="noreferrer"
          title="Otevřít stránku, kterou uvidí nálezce"
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-[11px] text-gray-600 transition hover:bg-gray-50"
        >
          <ExternalLink className="h-3 w-3" aria-hidden />
          stránka
        </a>
      </div>

      {!card.mine && (
        <p className="mt-1.5 text-[11px] text-gray-500">
          {card.areaLabel ? `Oblast ${card.areaLabel}` : "Bez oblasti"} — místo
          úkrytu tenhle odkaz neukazuje.
        </p>
      )}

      {coords && (
        <button
          type="button"
          onClick={copy}
          className="mt-1.5 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 font-mono text-[11px] text-gray-600 transition hover:bg-gray-50"
          title="Zkopírovat souřadnice"
        >
          {copied ? (
            <Check className="h-3 w-3 text-emerald-600" aria-hidden />
          ) : (
            <Copy className="h-3 w-3" aria-hidden />
          )}
          {coords}
        </button>
      )}
      {card.mine && !coords && (
        <p className="mt-1.5 text-[11px] text-amber-700">Zatím bez pozice.</p>
      )}

      {card.teamNote && (
        <p className="mt-1.5 whitespace-pre-line rounded-md bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900">
          {card.teamNote}
        </p>
      )}

      <button
        type="button"
        onClick={() => setOpenText((v) => !v)}
        aria-expanded={openText}
        className="mt-1.5 text-[11px] text-gray-500 underline-offset-2 hover:underline"
      >
        {openText ? "Skrýt text kartičky" : "Text kartičky"}
      </button>
      {openText && (
        <div className="mt-1 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2">
          <p className="text-xs font-semibold text-gray-900">{card.heading}</p>
          <p className="mt-1 whitespace-pre-line text-[11px] leading-relaxed text-gray-600">
            {card.body}
          </p>
        </div>
      )}

      {showQr && (
        // Fetched per card and only while previews are on: a whole wave of
        // inline SVG would be a megabyte of HTML nobody asked for.
        //
        // A plain <img>, not next/image: the source is an SVG from a
        // cookie-gated route, and the optimiser neither can nor should
        // touch it (it would need dangerouslyAllowSVG, and there is
        // nothing to optimise about vector line art).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/tym/${token}/qr/${card.id}`}
          alt={`QR kód kartičky ${card.findId}`}
          loading="lazy"
          className="mt-2 w-28 rounded-md border border-gray-200 bg-white p-1"
        />
      )}
    </li>
  );
}

/** "12. 8. v 20:41" — enough for "did my edit land yet". */
function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("cs-CZ", {
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}
