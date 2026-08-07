"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Eraser,
  ExternalLink,
  Gift,
  Link2Off,
  Loader2,
  Pin,
  RotateCcw,
  Search,
  StickyNote,
} from "lucide-react";
import {
  previewFindQrAction,
  setFindQrRevokedAction,
  resetFindQrScansAction,
} from "./find-qr-actions";
import { downloadPng, downloadSvg } from "./qr-download";
import { Seg, INPUT_CLS } from "./qr-ui";
import type { FindQrInput } from "./qr-types";

export interface FindQrListItem {
  findId: number;
  /** LSP note. Admin-only surface, so it is shown verbatim — the public
   *  site still reads notes exclusively through `anonymize()`. */
  note: string | null;
  /** Pre-formatted full date + time in the collection's zone. Formatted
   *  server-side on purpose: re-deriving it here would use the browser's
   *  zone and reintroduce the bug lib/collectionTime.ts exists to stop. */
  foundAt: string | null;
  donated: boolean;
  pinned: boolean;
  revoked: boolean;
  scansTotal: number;
  scans30: number;
  scans7: number;
}

type Order = "desc" | "asc";

/** ~20 rows before the box starts scrolling (a row runs ~74 px). Donated
 *  finds are the ones actually printed onto cards, so that list earns the
 *  height; the other two stay compact. */
const TALL_LIST = "max-h-[92rem]";
const SHORT_LIST = "max-h-[30rem]";
const ORDER_OPTS = [
  { v: "desc", l: "Nejnovější", title: "Od nejvyššího čísla nálezu" },
  { v: "asc", l: "Nejstarší", title: "Od nejnižšího čísla nálezu" },
];

export function FindQrList({
  items,
  cfg,
  selected,
  onToggle,
  onSetMany,
  onDownloadSelection,
}: {
  items: FindQrListItem[];
  /** Current form setup — single-row downloads use it so a code pulled
   *  from the list matches the batch the form would produce. */
  cfg: FindQrInput;
  selected: ReadonlySet<number>;
  onToggle: (findId: number) => void;
  /** Bulk check/uncheck for the rows currently visible after filtering. */
  onSetMany: (findIds: number[], checked: boolean) => void;
  onDownloadSelection: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [noteQuery, setNoteQuery] = useState("");
  const [onlyScanned, setOnlyScanned] = useState(false);
  // Newest first by default: the collection only grows, so the codes worth
  // printing are almost always the ones just added.
  const [order, setOrder] = useState<Order>("desc");
  const [busy, startBusy] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);

  const { donated, others, revoked } = useMemo(() => {
    const q = query.trim();
    // Diacritics-insensitive so "chate" finds "chatě" — the notes are Czech
    // free text and nobody types the háčky when searching.
    const nq = fold(noteQuery);
    const matches = (i: FindQrListItem) => {
      if (q && !String(i.findId).includes(q)) return false;
      if (nq && !fold(i.note ?? "").includes(nq)) return false;
      if (onlyScanned && i.scansTotal === 0) return false;
      return true;
    };
    const byOrder = (a: FindQrListItem, b: FindQrListItem) =>
      order === "desc" ? b.findId - a.findId : a.findId - b.findId;
    const live = items.filter((i) => !i.revoked && matches(i));
    return {
      donated: live.filter((i) => i.donated).sort(byOrder),
      others: live.filter((i) => !i.donated).sort(byOrder),
      revoked: items.filter((i) => i.revoked && matches(i)).sort(byOrder),
    };
  }, [items, query, noteQuery, onlyScanned, order]);

  const active = [...donated, ...others];
  const visibleIds = active.map((i) => i.findId);
  const allChecked =
    visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const selectedCount = selected.size;
  const totalScans = items.reduce((s, i) => s + i.scansTotal, 0);

  const wipeAll = () => {
    setError(null);
    startBusy(async () => {
      const r = await resetFindQrScansAction(null);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setConfirmWipe(false);
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500 transition hover:text-gray-700"
      >
        {open ? (
          <ChevronDown className="h-4 w-4" aria-hidden />
        ) : (
          <ChevronRight className="h-4 w-4" aria-hidden />
        )}
        Seznam
        <span className="font-normal normal-case tracking-normal text-gray-400">
          ({items.length.toLocaleString("cs-CZ")} nálezů · {totalScans}{" "}
          naskenování
          {selectedCount > 0 && ` · vybráno ${selectedCount}`})
        </span>
      </button>

      {open && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"
                aria-hidden
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Hledat číslo"
                aria-label="Hledat podle čísla nálezu"
                className={`${INPUT_CLS} w-36 py-1 pl-7 text-xs`}
              />
            </div>
            <div className="relative">
              <StickyNote
                className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"
                aria-hidden
              />
              <input
                type="search"
                value={noteQuery}
                onChange={(e) => setNoteQuery(e.target.value)}
                placeholder="Hledat v poznámce"
                aria-label="Hledat v poznámce nálezu"
                className={`${INPUT_CLS} w-44 py-1 pl-7 text-xs`}
              />
            </div>
            <Seg
              value={order}
              onChange={(v) => setOrder(v as Order)}
              options={ORDER_OPTS}
            />
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-700">
              <input
                type="checkbox"
                checked={onlyScanned}
                onChange={(e) => setOnlyScanned(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-gray-300 text-brand-600 focus:ring-brand-500/30"
              />
              Skrýt nenaskenované
            </label>

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onSetMany(visibleIds, !allChecked)}
                disabled={visibleIds.length === 0}
                className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
              >
                {allChecked
                  ? "Odznačit vše"
                  : `Označit vše (${visibleIds.length})`}
              </button>
              <button
                type="button"
                onClick={onDownloadSelection}
                disabled={selectedCount === 0}
                className="inline-flex items-center gap-1.5 rounded-md border border-brand-300 bg-brand-50 px-2 py-1 text-xs font-medium text-brand-800 transition hover:bg-brand-100 disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                Stáhnout výběr ({selectedCount})
              </button>
              {confirmWipe ? (
                <span className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-900">
                  Smazat všechny skeny?
                  <button
                    type="button"
                    onClick={wipeAll}
                    disabled={busy}
                    className="font-semibold underline-offset-2 hover:underline"
                  >
                    Ano
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmWipe(false)}
                    className="underline-offset-2 hover:underline"
                  >
                    Ne
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmWipe(true)}
                  disabled={totalScans === 0}
                  title="Smazat historii naskenování u všech nálezů"
                  className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
                >
                  <Eraser className="h-3.5 w-3.5" aria-hidden />
                  Vynulovat počty
                </button>
              )}
            </div>
          </div>

          {error && (
            <p className="rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
              {error}
            </p>
          )}

          {items.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-500">
              Zatím tu nic není.
            </p>
          ) : (
            <>
              {/* Three standing sections rather than one list behind a
                  filter: donated finds are the ones that actually get
                  printed onto cards, so they deserve their own box that
                  doesn't disappear when the filter is set elsewhere. Each
                  renders even when empty, so a section never silently
                  vanishes. */}
              <Section
                title="Darované"
                note="nálezy, ke kterým se tiskne kartička"
                rows={donated}
                emptyText="Žádný nález nemá stav Darovaný."
                heightClass={TALL_LIST}
                cfg={cfg}
                selected={selected}
                onToggle={onToggle}
                onSetMany={onSetMany}
              />
              <Section
                title="Ostatní"
                note="ručně přidané nebo naskenované"
                rows={others}
                emptyText="Žádný další nález v seznamu."
                heightClass={SHORT_LIST}
                cfg={cfg}
                selected={selected}
                onToggle={onToggle}
                onSetMany={onSetMany}
              />
              <Section
                title="Zrušené"
                note="kód dál vede na detail, jen se nezapočítává"
                rows={revoked}
                emptyText="Žádný zrušený kód."
                heightClass={SHORT_LIST}
                cfg={cfg}
                selected={selected}
                onToggle={onToggle}
                onSetMany={onSetMany}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

function Section({
  title,
  note,
  rows,
  emptyText,
  heightClass,
  cfg,
  selected,
  onToggle,
  onSetMany,
}: {
  title: string;
  note: string;
  rows: FindQrListItem[];
  emptyText: string;
  heightClass: string;
  cfg: FindQrInput;
  selected: ReadonlySet<number>;
  onToggle: (findId: number) => void;
  onSetMany: (findIds: number[], checked: boolean) => void;
}) {
  const ids = rows.map((r) => r.findId);
  const allChecked = ids.length > 0 && ids.every((id) => selected.has(id));
  return (
    <div className="space-y-2 pt-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {title}{" "}
          <span className="font-normal text-gray-400">
            ({rows.length}) — {note}
          </span>
        </h4>
        {ids.length > 0 && (
          <button
            type="button"
            onClick={() => onSetMany(ids, !allChecked)}
            className="ml-auto rounded-md border border-gray-300 bg-white px-2 py-0.5 text-[11px] font-medium text-gray-700 transition hover:bg-gray-50"
          >
            {allChecked ? "Odznačit" : `Označit (${ids.length})`}
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-4 text-center text-xs text-gray-500">
          {emptyText}
        </p>
      ) : (
        // Bounded height instead of pagination — the operator asked for no
        // pages, and thousands of rows would otherwise make the tab
        // unusable to scroll past.
        <ul className={`${heightClass} space-y-2 overflow-y-auto pr-1`}>
          {rows.map((it) => (
            <Row
              key={it.findId}
              item={it}
              cfg={cfg}
              checked={selected.has(it.findId)}
              onToggle={() => onToggle(it.findId)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Lowercased and stripped of diacritics, so a Czech note search works
 *  without the user reproducing háčky and čárky. */
function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function Row({
  item,
  cfg,
  checked,
  onToggle,
}: {
  item: FindQrListItem;
  cfg: FindQrInput;
  checked: boolean;
  onToggle: () => void;
}) {
  const router = useRouter();
  const [dl, setDl] = useState<"svg" | "png" | null>(null);
  const [busy, startBusy] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleDownload = async (kind: "svg" | "png") => {
    setError(null);
    setDl(kind);
    try {
      const r = await previewFindQrAction(item.findId, cfg);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const base = `ctyrlistek-${item.findId}`;
      if (kind === "svg") downloadSvg(r.svg, `${base}.svg`);
      else await downloadPng(r.svg, `${base}.png`, 2);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Stažení selhalo");
    } finally {
      setDl(null);
    }
  };

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startBusy(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Akce selhala");
      else router.refresh();
    });
  };

  return (
    <li
      className={`rounded-lg border p-3 ${
        item.revoked
          ? "border-gray-200 bg-gray-50"
          : checked
            ? "border-brand-300 bg-brand-50/50"
            : "border-gray-200 bg-white"
      }`}
    >
      <div className="flex flex-wrap items-start gap-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          aria-label={`Vybrat nález ${item.findId}`}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-brand-600 focus:ring-brand-500/30"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-sm font-semibold text-gray-900">
              🍀 #{item.findId}
            </span>
            {item.donated && (
              <span className="inline-flex items-center gap-1 rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand-800">
                <Gift className="h-3 w-3" aria-hidden />
                Darovaný
              </span>
            )}
            {item.pinned && !item.donated && (
              <span className="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-600">
                <Pin className="h-3 w-3" aria-hidden />
                Vlastní
              </span>
            )}
            {item.revoked && (
              <span className="inline-flex items-center gap-1 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-rose-800">
                <Link2Off className="h-3 w-3" aria-hidden />
                Zrušený
              </span>
            )}
            <span className="font-mono text-[11px] text-gray-500">
              /n/{item.findId}
            </span>
            {item.foundAt && (
              <span className="text-[11px] text-gray-400">{item.foundAt}</span>
            )}
          </div>
          {item.note && (
            <p className="mt-1 whitespace-pre-line text-xs italic text-gray-600">
              {item.note}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3 text-center">
          <Stat value={item.scansTotal} label="celkem" strong />
          <Stat value={item.scans30} label="30 d" />
          <Stat value={item.scans7} label="7 d" />
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <IconBtn
            onClick={() => handleDownload("svg")}
            busy={dl === "svg"}
            label={`Stáhnout SVG nálezu ${item.findId}`}
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            <span className="ml-1 text-[11px]">SVG</span>
          </IconBtn>
          <IconBtn
            onClick={() => handleDownload("png")}
            busy={dl === "png"}
            label={`Stáhnout PNG nálezu ${item.findId}`}
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            <span className="ml-1 text-[11px]">PNG</span>
          </IconBtn>
          <Link
            href={`/sbirka/${item.findId}`}
            target="_blank"
            rel="noreferrer"
            aria-label={`Otevřít detail nálezu ${item.findId}`}
            className="inline-flex items-center rounded-md border border-gray-300 bg-white px-2 py-1 text-gray-600 transition hover:bg-gray-50"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </Link>
          <IconBtn
            onClick={() => act(() => resetFindQrScansAction(item.findId))}
            busy={busy}
            disabled={item.scansTotal === 0}
            label={`Vynulovat počet naskenování nálezu ${item.findId}`}
          >
            <Eraser className="h-3.5 w-3.5" aria-hidden />
          </IconBtn>
          <IconBtn
            onClick={() =>
              act(() => setFindQrRevokedAction(item.findId, !item.revoked))
            }
            busy={busy}
            label={
              item.revoked
                ? `Obnovit QR kód nálezu ${item.findId}`
                : `Zrušit QR kód nálezu ${item.findId}`
            }
          >
            {item.revoked ? (
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Link2Off className="h-3.5 w-3.5" aria-hidden />
            )}
          </IconBtn>
        </div>
      </div>
      {error && (
        <p className="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-800">
          {error}
        </p>
      )}
    </li>
  );
}

function Stat({
  value,
  label,
  strong = false,
}: {
  value: number;
  label: string;
  strong?: boolean;
}) {
  return (
    <div>
      <p
        className={`font-mono text-sm tabular-nums ${
          strong ? "font-bold text-brand-700" : "text-gray-600"
        }`}
      >
        {value.toLocaleString("cs-CZ")}
      </p>
      <p className="text-[10px] uppercase tracking-wide text-gray-400">
        {label}
      </p>
    </div>
  );
}

function IconBtn({
  onClick,
  busy,
  label,
  disabled = false,
  children,
}: {
  onClick: () => void;
  busy: boolean;
  label: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      aria-label={label}
      title={label}
      className="inline-flex items-center rounded-md border border-gray-300 bg-white px-2 py-1 text-gray-600 transition hover:bg-gray-50 disabled:opacity-40"
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : (
        children
      )}
    </button>
  );
}
