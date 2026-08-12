"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import {
  Check,
  Copy,
  Crosshair,
  ExternalLink,
  Lightbulb,
  Link2,
  Maximize2,
  MapPin,
  QrCode,
  Search,
  StickyNote,
  Table2,
  Users,
  X,
} from "lucide-react";
import { formatGpsDecimal } from "@/lib/parseGps";
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
  /** Bonus block, item's own or the wave's. */
  bonus: string | null;
  /** English side, built from English fields only — null when there is
   *  none, because a Czech fallback under "anglicky" would be a lie. */
  en: { heading: string; body: string; bonus: string | null } | null;
  /** Which texts this card says itself instead of inheriting. */
  ownText: string[];
  /** What is physically printed on it. */
  printed: { title: string | null; caption: string | null; sizeCm: number };
  /** Position in the wave by find number — the same "13. ze 111" the
   *  finder is shown. */
  ordinal: number;
  lastScanAt: string | null;
  /** The clue this card publishes: its own, else the wave's. */
  hint: string | null;
  /** Shown on the find's public detail page, not just in the hunt. */
  hintPublished: boolean;
  /** Where it sits in its area's "řetězec čtyřlístků", if it is in one. */
  chain: { position: number; total: number; nextFindId: number | null } | null;
}

export interface SheetStatus {
  mode: boolean;
  syncedAt: string | null;
  changedAt: string | null;
  error: string | null;
  /** The shared spreadsheet, but only when the admin ticked "show it to
   *  the crew" — null otherwise, and then nothing is rendered. */
  url: string | null;
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
/**
 * One colour per crew member, assigned by their place in the wave's roster
 * so it never shifts between page loads. Deliberately far apart in hue —
 * these sit as a thin ring around a status-coloured clover, and two people
 * whose colours are neighbours are worse than no colours at all.
 */
const CREW_COLORS = [
  "#7c3aed",
  "#db2777",
  "#0891b2",
  "#ca8a04",
  "#4d7c0f",
  "#b45309",
  "#4f46e5",
  "#be123c",
];

export function CrewView({
  token,
  placers,
  total,
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
  /** The wave's roster, in its own order — drives the colours. */
  placers: string[];
  /** Cards in the whole wave, for the "13. ze 111" line. */
  total: number;
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
  /** The spot last tapped on the map — a ruler, not a pen. */
  const [picked, setPicked] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  /** Whose cards to show; null = everybody's. */
  const [crew, setCrew] = useState<string | null>(null);
  const [grouped, setGrouped] = useState(true);

  // Everybody who actually appears on a card, roster first so the colours
  // follow the roster's order, then anyone the sheet introduced.
  const crewNames = useMemo(() => {
    const seen = new Set(
      cards.map((c) => c.placedBy).filter((n): n is string => !!n),
    );
    const ordered = placers.filter((p) => seen.has(p));
    for (const n of seen) if (!ordered.includes(n)) ordered.push(n);
    return ordered;
  }, [cards, placers]);

  const colorOf = (name: string | null): string | null =>
    name === null
      ? null
      : (CREW_COLORS[crewNames.indexOf(name) % CREW_COLORS.length] ?? null);

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
      chainLength: mine.filter((c) => c.chain !== null).length,
    };
  }, [mine]);

  const visible = useMemo(() => {
    const q = query.trim().replace(/^#/, "");
    return cards.filter((c) => {
      if (onlyMine && !c.mine) return false;
      if (crew !== null && c.placedBy !== crew) return false;
      if (statuses.size > 0 && !statuses.has(c.status)) return false;
      if (q && !String(c.findId).includes(q)) return false;
      return true;
    });
  }, [cards, statuses, query, onlyMine, crew]);

  /**
   * The list, in sections by crew member.
   *
   * Splitting a town between people is the normal case, and "which ones
   * are mine" is then the first question — a flat list answers it only by
   * reading every row. One section per person, in roster order, with the
   * unassigned last.
   */
  const sections = useMemo(() => {
    if (!grouped) return [{ name: null as string | null, cards: visible }];
    const out: { name: string | null; cards: CrewCard[] }[] = [];
    for (const name of crewNames) {
      const mineHere = visible.filter((c) => c.placedBy === name);
      if (mineHere.length > 0) out.push({ name, cards: mineHere });
    }
    const orphans = visible.filter((c) => !c.placedBy);
    if (orphans.length > 0) out.push({ name: null, cards: orphans });
    return out;
  }, [visible, crewNames, grouped]);

  // Only placed cards of THIS area are drawn; the filter follows the list
  // so hiding a status hides its pins too.
  const points = useMemo(
    () =>
      // Not `visible`: a crew filter FADES the others rather than removing
      // them, because a hiding place two streets away is context even when
      // it is somebody else's.
      cards
        .filter((c) => c.mine && c.lat !== null && c.lng !== null)
        .filter((c) => statuses.size === 0 || statuses.has(c.status))
        .map((c) => ({
          ...c,
          lat: c.lat!,
          lng: c.lng!,
          crewColor: colorOf(c.placedBy),
          dimmed: crew !== null && c.placedBy !== crew,
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cards, statuses, crew, crewNames],
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
          {stats.chainLength > 0 && (
            <span className="inline-flex items-center gap-1 text-violet-800">
              <Link2 className="h-3.5 w-3.5" aria-hidden />
              řetěz o{" "}
              <strong className="font-mono tabular-nums">
                {stats.chainLength}
              </strong>{" "}
              kartičkách
            </span>
          )}
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
              {sheet.url && (
                <a
                  href={sheet.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-900 transition hover:bg-emerald-100"
                >
                  <Table2 className="h-3.5 w-3.5" aria-hidden />
                  Otevřít tabulku
                </a>
              )}
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
            onPick={(lat, lng) => setPicked({ lat, lng })}
            picked={picked}
          />
          <PickedCoords picked={picked} onClose={() => setPicked(null)} />
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

            {crewNames.length > 1 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {crewNames.map((name) => {
                  const on = crew === name;
                  const count = cards.filter(
                    (c) => (!onlyMine || c.mine) && c.placedBy === name,
                  ).length;
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setCrew(on ? null : name)}
                      aria-pressed={on}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                        on
                          ? "border-gray-900 bg-gray-900 text-white"
                          : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      <span
                        className="h-2 w-2 rounded-full ring-2"
                        style={{
                          backgroundColor: colorOf(name) ?? "#9ca3af",
                          // @ts-expect-error -- CSS custom property for the ring
                          "--tw-ring-color": `${colorOf(name)}33`,
                        }}
                        aria-hidden
                      />
                      {name}
                      <span className="tabular-nums opacity-70">{count}</span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setGrouped((v) => !v)}
                  aria-pressed={grouped}
                  title="Seskupit seznam po lidech"
                  className={`ml-auto inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                    grouped
                      ? "border-gray-900 bg-gray-900 text-white"
                      : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <Users className="h-3.5 w-3.5" aria-hidden />
                  po lidech
                </button>
              </div>
            )}

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
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {sections.map((s) => (
              <section key={s.name ?? "—"} className="mb-3 last:mb-0">
                {grouped && crewNames.length > 1 && (
                  <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{
                        backgroundColor: colorOf(s.name) ?? "#9ca3af",
                      }}
                      aria-hidden
                    />
                    {s.name ?? "Bez přiřazení"}
                    <span className="font-normal tabular-nums text-gray-400">
                      {s.cards.length}
                    </span>
                  </p>
                )}
                <ul className="space-y-2">
                  {s.cards.map((c) => (
                    <CrewRow
                      key={c.id}
                      token={token}
                      card={c}
                      total={total}
                      crewColor={colorOf(c.placedBy)}
                      showQr={showQr}
                      selected={c.id === selected}
                      onSelect={() => setSelected(c.id)}
                    />
                  ))}
                </ul>
              </section>
            ))}
            {visible.length === 0 && (
              <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-6 text-center text-xs text-gray-500">
                Nic neodpovídá filtru.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The coordinates of wherever the map was last tapped, ready to be pasted
 * into the shared spreadsheet.
 *
 * The crew fills that sheet by hand, and "what are the coordinates of that
 * bench" otherwise means a detour through a third-party map app. Written
 * in exactly the form the workbook's GPS column is parsed from
 * (`formatGpsDecimal`), so what is copied here goes in without editing.
 *
 * It reads; it never writes. The page has no way to save a position, and
 * the panel says so — otherwise a tap on the map looks like it might have
 * moved a card.
 */
function PickedCoords({
  picked,
  onClose,
}: {
  picked: { lat: number; lng: number } | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  if (!picked) {
    return (
      <p className="pointer-events-none absolute bottom-3 left-1/2 z-[500] -translate-x-1/2 rounded-full bg-white/95 px-3 py-1.5 text-[11px] text-gray-600 shadow-sm">
        Klepni do mapy a přečteš souřadnice pro tabulku.
      </p>
    );
  }

  const text = formatGpsDecimal(picked.lat, picked.lng);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked — the number is on screen to read off.
    }
  };

  return (
    <div className="absolute bottom-3 left-1/2 z-[500] w-[min(22rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-xl border border-violet-200 bg-white/97 p-3 shadow-lg">
      <div className="flex items-center gap-2">
        <Crosshair className="h-4 w-4 shrink-0 text-violet-600" aria-hidden />
        <p className="text-xs font-semibold text-gray-900">
          Souřadnice pro tabulku
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Zavřít"
          className="ml-auto rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <button
        type="button"
        onClick={copy}
        className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-violet-300 bg-violet-50 px-3 py-2 font-mono text-sm text-violet-900 transition hover:bg-violet-100"
      >
        {copied ? (
          <Check className="h-4 w-4 text-emerald-600" aria-hidden />
        ) : (
          <Copy className="h-4 w-4" aria-hidden />
        )}
        {text}
      </button>
      <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">
        Zkopíruj a vlož do sloupce <strong>GPS</strong> ve sdílené tabulce.
        Odsud se nikam nic nezapisuje.
      </p>
    </div>
  );
}

function CrewRow({
  token,
  card,
  total,
  crewColor,
  showQr,
  selected,
  onSelect,
}: {
  token: string;
  card: CrewCard;
  total: number;
  crewColor: string | null;
  showQr: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [openText, setOpenText] = useState(false);
  // Same helper the workbook's GPS column is written with, so a coordinate
  // copied from a row pastes back in unchanged.
  const coords =
    card.lat !== null && card.lng !== null
      ? formatGpsDecimal(card.lat, card.lng)
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
            {card.placedBy && (
              <>
                {" · "}
                <span
                  className="inline-block h-2 w-2 translate-y-[1px] rounded-full"
                  style={{ backgroundColor: crewColor ?? "#9ca3af" }}
                  aria-hidden
                />{" "}
                {card.placedBy}
              </>
            )}
            {" · "}
            <span className="tabular-nums">
              {card.ordinal}. ze {total}
            </span>
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

      {(card.scans > 0 || card.foundAt) && (
        <p className="mt-1 text-[11px] text-gray-500">
          {card.scans > 0 ? (
            <>
              <span className="font-mono tabular-nums">{card.scans}×</span>{" "}
              naskenováno
              {card.lastScanAt && <> · naposledy {card.lastScanAt}</>}
            </>
          ) : (
            "zatím bez naskenování"
          )}
          {card.foundAt && (
            <span className="text-emerald-700"> · nalezeno {card.foundAt}</span>
          )}
        </p>
      )}

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

      {/* Labelled, because it sits next to the hint and the two say very
          different things: the note is the crew's own description of the
          hiding place, the hint is what a finder is told. Unlabelled they
          were guesswork. */}
      {card.teamNote && (
        <div className="mt-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900">
          <p className="flex items-center gap-1.5 font-semibold uppercase tracking-wide">
            <StickyNote className="h-3 w-3" aria-hidden />
            Poznámka týmu
          </p>
          <p className="mt-0.5 whitespace-pre-line">{card.teamNote}</p>
        </div>
      )}

      {/* The hunt. Both halves matter in the field: which card this one
          sends people to, and what clue it hands out — a chained card
          whose clue is empty is a dead end, and that is worth seeing
          BEFORE it is laminated. */}
      {card.chain && (
        <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 rounded-md bg-violet-50 px-2.5 py-1.5 text-[11px] text-violet-900">
          <Link2 className="h-3 w-3 shrink-0" aria-hidden />
          <span>
            Řetěz{" "}
            <strong className="font-mono tabular-nums">
              {card.chain.position}/{card.chain.total}
            </strong>
          </span>
          {card.chain.nextFindId !== null ? (
            <span className="font-mono">→ #{card.chain.nextFindId}</span>
          ) : (
            <span className="text-violet-700">· poslední, tady řetěz končí</span>
          )}
        </p>
      )}

      {(card.hint || card.hintPublished || card.chain) && (
        <p className="mt-1.5 flex items-start gap-1.5 rounded-md bg-gray-50 px-2.5 py-1.5 text-[11px] text-gray-700">
          <Lightbulb className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" aria-hidden />
          <span>
            {card.hint ? (
              <>
                <span className="font-medium">Nápověda:</span> {card.hint}
              </>
            ) : (
              <span className="text-amber-700">
                Nápověda není napsaná
                {card.chain && card.chain.nextFindId !== null
                  ? " — předchozí kartička nemá co odkrýt."
                  : "."}
              </span>
            )}
            {card.hint && (
              <span className="ml-1 text-gray-400">
                {card.hintPublished
                  ? "· zveřejněná i na stránce nálezu"
                  : card.chain
                    ? "· jen v řetězu, na stránce nálezu není"
                    : "· zatím se nikde neukazuje"}
              </span>
            )}
          </span>
        </p>
      )}

      <button
        type="button"
        onClick={() => setOpenText((v) => !v)}
        aria-expanded={openText}
        className="mt-1.5 text-[11px] text-gray-500 underline-offset-2 hover:underline"
      >
        {openText ? "Skrýt detail kartičky" : "Detail kartičky"}
      </button>
      {openText && (
        <div className="mt-1 space-y-2 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              Stránka po naskenování · česky
            </p>
            <p className="mt-0.5 text-xs font-semibold text-gray-900">
              {card.heading}
            </p>
            <p className="mt-0.5 whitespace-pre-line text-[11px] leading-relaxed text-gray-600">
              {card.body}
            </p>
            {card.bonus && (
              <p className="mt-1 whitespace-pre-line rounded border border-brand-200 bg-brand-50/70 px-2 py-1 text-[11px] leading-relaxed text-gray-700">
                <span className="font-semibold">Bonus:</span> {card.bonus}
              </p>
            )}
          </div>

          {card.en && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                Anglicky
              </p>
              {card.en.heading && (
                <p className="mt-0.5 text-xs font-semibold text-gray-900">
                  {card.en.heading}
                </p>
              )}
              {card.en.body && (
                <p className="mt-0.5 whitespace-pre-line text-[11px] leading-relaxed text-gray-600">
                  {card.en.body}
                </p>
              )}
              {card.en.bonus && (
                <p className="mt-1 whitespace-pre-line rounded border border-brand-200 bg-brand-50/70 px-2 py-1 text-[11px] leading-relaxed text-gray-700">
                  <span className="font-semibold">Bonus:</span> {card.en.bonus}
                </p>
              )}
            </div>
          )}

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              Natištěno na kartičce
            </p>
            <p className="mt-0.5 text-[11px] text-gray-600">
              Nad kódem:{" "}
              <span className="font-medium text-gray-800">
                {card.printed.title ?? "nic"}
              </span>{" "}
              · pod kódem:{" "}
              <span className="font-medium text-gray-800">
                {card.printed.caption ?? "nic"}
              </span>{" "}
              · šířka{" "}
              <span className="font-mono tabular-nums text-gray-800">
                {card.printed.sizeCm} cm
              </span>
            </p>
          </div>

          {card.ownText.length > 0 && (
            <p className="text-[10px] text-gray-400">
              Vlastní text kartičky: {card.ownText.join(", ")} — zbytek se
              dědí ze sady.
            </p>
          )}
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
