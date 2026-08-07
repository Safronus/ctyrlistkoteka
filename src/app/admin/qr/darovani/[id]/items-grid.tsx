"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ExternalLink,
  Loader2,
  Pencil,
  Plus,
  Printer,
  QrCode,
  RotateCcw,
  ScanLine,
  Trash2,
} from "lucide-react";
import {
  addItemsAction,
  bulkUpdateItemsAction,
  removeItemsAction,
  renderDropQrBatchAction,
  resetScansAction,
} from "../../drop-actions";
import { DROP_STATUS_LABEL, DROP_STATUS_ORDER } from "@/lib/admin/dropVocab";
import type { DropStatus } from "@/generated/prisma/enums";
import {
  CONTROL_H,
  CONTROL_H_SM,
  Field,
  INPUT_CLS,
  LABEL_H,
  ROW_CLS,
  SELECT_CLS,
} from "../../qr-ui";
import { ItemDialog, type CampaignDefaults } from "./item-dialog";
import { DropPrintDialog } from "./print-dialog";

export interface ItemView {
  id: number;
  findId: number;
  areaId: number | null;
  status: DropStatus;
  placedBy: string | null;
  lat: number | null;
  lng: number | null;
  scans: number;
  foundAt: string | null;
  landingUrl: string;
  hintPublished: boolean;
  overrides: string[];
  detail: {
    headingCs: string;
    headingEn: string;
    bodyCs: string;
    bodyEn: string;
    bonusCs: string;
    bonusEn: string;
    qrTitle: string;
    qrCaption: string;
    /** Empty string means "inherit the campaign's size". */
    sizeCm: string;
    hintCs: string;
    hintEn: string;
  };
}

const STATUS_TONE: Record<DropStatus, string> = {
  PREPARED: "bg-gray-100 text-gray-700",
  PRINTED: "bg-amber-100 text-amber-900",
  HIDDEN: "bg-sky-100 text-sky-900",
  FOUND: "bg-brand-100 text-brand-800",
};

/**
 * The wave's cards as a grid of real QR previews.
 *
 * A hundred-odd pieces is few enough to show each one's actual code —
 * which matters because every card may carry its own title and look, and
 * a table of numbers wouldn't reveal a card whose override went wrong.
 * The previews render lazily and in batches of forty, so opening the page
 * doesn't cost a hundred round trips before it settles.
 */
export function ItemsGrid({
  campaignId,
  campaignName,
  campaignDefaults,
  items,
  areas,
  placers,
}: {
  campaignId: number;
  campaignName: string;
  campaignDefaults: CampaignDefaults;
  items: ItemView[];
  areas: Array<{ id: number; name: string }>;
  placers: string[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [areaFilter, setAreaFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [spec, setSpec] = useState("");
  const [addArea, setAddArea] = useState<string>("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openItem, setOpenItem] = useState<ItemView | null>(null);
  const [svgs, setSvgs] = useState<Record<number, string>>({});
  const [printing, setPrinting] = useState<number[] | null>(null);
  // Two-step, because zeroing counters is not undoable and the button
  // sits in a strip of one-click bulk edits.
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, start] = useTransition();

  const shown = useMemo(() => {
    const q = query.trim();
    return items.filter((i) => {
      if (q && !String(i.findId).includes(q)) return false;
      if (areaFilter !== "all") {
        const want = areaFilter === "none" ? null : Number(areaFilter);
        if (i.areaId !== want) return false;
      }
      if (statusFilter !== "all" && i.status !== statusFilter) return false;
      return true;
    });
  }, [items, query, areaFilter, statusFilter]);

  // Render the visible cards' codes in batches rather than one request
  // each: 111 cards used to mean 111 round trips before the page settled.
  const shownKey = shown.map((i) => i.id).join(",");
  useEffect(() => {
    let alive = true;
    const missing = shown.filter((i) => svgs[i.id] === undefined).map((i) => i.id);
    if (missing.length === 0) return;
    (async () => {
      for (let i = 0; i < missing.length; i += 40) {
        const r = await renderDropQrBatchAction(missing.slice(i, i + 40));
        if (!alive) return;
        if (r.ok) {
          setSvgs((prev) => {
            const next = { ...prev };
            for (const it of r.items) next[it.id] = it.svg;
            return next;
          });
        }
      }
    })();
    return () => {
      alive = false;
    };
    // `svgs` is deliberately out of the deps: it is what the effect fills
    // in, and including it would re-run the effect after every chunk.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownKey]);

  // Identity-stable, so the memoised cards actually skip re-rendering:
  // an inline arrow would be a new prop on every keystroke in the filter.
  const toggle = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const openCard = useCallback((it: ItemView) => setOpenItem(it), []);

  const allShownChecked =
    shown.length > 0 && shown.every((i) => selected.has(i.id));

  // Selection wins when there is one, otherwise everything the filters
  // currently show — so "print what I'm looking at" needs no extra step,
  // and an accidental whole-wave sheet takes a deliberate filter reset.
  const printIds = useMemo(
    () =>
      selected.size > 0
        ? shown.filter((i) => selected.has(i.id)).map((i) => i.id)
        : shown.map((i) => i.id),
    [shown, selected],
  );

  const run = (
    fn: () => Promise<{ ok: boolean; error?: string }>,
    okMsg: string,
  ) => {
    setError(null);
    setNotice(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        setError(r.error ?? "Akce selhala");
        return;
      }
      setNotice(okMsg);
      setSelected(new Set());
      setConfirmReset(false);
      router.refresh();
    });
  };

  return (
    <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900">
          Kusy{" "}
          <span className="font-normal text-gray-400">
            ({items.length.toLocaleString("cs-CZ")})
          </span>
        </h2>
        <button
          type="button"
          disabled={printIds.length === 0}
          onClick={() => setPrinting(printIds)}
          className={`${CONTROL_H_SM} inline-flex items-center gap-1.5 rounded-md border border-brand-300 bg-brand-50 px-3 text-xs font-medium text-brand-800 transition hover:border-brand-400 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50`}
        >
          <Printer className="h-3.5 w-3.5" aria-hidden />
          {selected.size > 0
            ? `Tiskový arch (${selected.size} vybraných)`
            : `Tiskový arch (${printIds.length})`}
        </button>
      </div>

      {/* --------------------------------------------------------- adding
          One grid row: the spec field, the area and the button share a
          baseline, and the hint hangs below without shoving the button
          out of line — `items-end` on a taller cell used to do exactly
          that. */}
      <div
        className={`${ROW_CLS} rounded-lg border border-gray-200 bg-gray-50 p-3 sm:grid-cols-[minmax(16rem,1fr)_11rem_auto]`}
      >
        <Field
          label="Přidat nálezy do sady"
          hint="Čísla a intervaly, např. 30001-30111. Musí už být ve sbírce."
        >
          <input
            className={`${INPUT_CLS} ${CONTROL_H} font-mono`}
            value={spec}
            onChange={(e) => setSpec(e.target.value)}
            placeholder="30001-30111"
          />
        </Field>
        <Field label="Do oblasti">
          <select
            className={`${SELECT_CLS} ${CONTROL_H}`}
            value={addArea}
            onChange={(e) => setAddArea(e.target.value)}
          >
            <option value="">— bez oblasti —</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <button
          type="button"
          disabled={busy || !spec.trim()}
          onClick={() =>
            start(async () => {
              setError(null);
              setNotice(null);
              const r = await addItemsAction(
                campaignId,
                spec,
                addArea ? Number(addArea) : null,
              );
              if (!r.ok) {
                setError(r.error);
                return;
              }
              const parts = [`Přidáno ${r.added} kusů`];
              if (r.taken.length) parts.push(`${r.taken.length} už v sadě je`);
              if (r.missing.length)
                parts.push(
                  `${r.missing.length} čísel ve sbírce není (${r.missing.slice(0, 6).join(", ")}${r.missing.length > 6 ? "…" : ""})`,
                );
              setNotice(parts.join(" · "));
              setSpec("");
              router.refresh();
            })
          }
          className={`${LABEL_H} ${CONTROL_H} inline-flex items-center gap-1.5 self-start rounded-md border border-emerald-300 bg-emerald-50 px-3 text-sm font-medium text-emerald-900 transition hover:bg-emerald-100 disabled:opacity-50`}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Plus className="h-4 w-4" aria-hidden />
          )}
          Přidat
        </button>
      </div>

      {/* ------------------------------------------------------ filters */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {/* Each control is boxed to its own width: INPUT_CLS/SELECT_CLS
            carry `w-full`, and a `w-32` appended after it does NOT win —
            Tailwind resolves width utilities by stylesheet order, not by
            the order they appear in the attribute. That is why these three
            used to stack full-width down the page. */}
        <div className="w-32">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Hledat číslo"
            aria-label="Hledat podle čísla nálezu"
            className={`${INPUT_CLS} ${CONTROL_H_SM} py-0 text-xs`}
          />
        </div>
        <div className="w-40">
          <select
            className={`${SELECT_CLS} ${CONTROL_H_SM} py-0 text-xs`}
            value={areaFilter}
            onChange={(e) => setAreaFilter(e.target.value)}
            aria-label="Filtr oblasti"
          >
            <option value="all">Všechny oblasti</option>
            <option value="none">Bez oblasti</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="w-40">
          <select
            className={`${SELECT_CLS} ${CONTROL_H_SM} py-0 text-xs`}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filtr stavu"
          >
            <option value="all">Všechny stavy</option>
            {DROP_STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {DROP_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          disabled={shown.length === 0}
          onClick={() =>
            setSelected((prev) => {
              const next = new Set(prev);
              for (const i of shown) {
                if (allShownChecked) next.delete(i.id);
                else next.add(i.id);
              }
              return next;
            })
          }
          className={`${CONTROL_H_SM} rounded-md border border-gray-300 bg-white px-2.5 font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50`}
        >
          {allShownChecked ? "Odznačit" : `Označit (${shown.length})`}
        </button>
        <span className="text-gray-500">
          {shown.length} z {items.length}
          {selected.size > 0 && ` · vybráno ${selected.size}`}
        </span>
      </div>

      {/* --------------------------------------------------- bulk edits */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-brand-200 bg-brand-50/60 p-3 text-xs">
          <span className="font-medium text-brand-900">
            {selected.size} vybráno:
          </span>
          <div className="w-44">
          <select
            className={`${SELECT_CLS} ${CONTROL_H_SM} py-0 text-xs`}
            aria-label="Hromadně změnit stav"
            defaultValue=""
            onChange={(e) => {
              const v = e.target.value;
              e.currentTarget.value = "";
              if (!v) return;
              run(
                () =>
                  bulkUpdateItemsAction(campaignId, [...selected], {
                    status: v,
                  }),
                "Stav změněn",
              );
            }}
          >
            <option value="">Změnit stav…</option>
            {DROP_STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {DROP_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          </div>
          <div className="w-44">
          <select
            className={`${SELECT_CLS} ${CONTROL_H_SM} py-0 text-xs`}
            aria-label="Hromadně přiřadit členu týmu"
            defaultValue=""
            onChange={(e) => {
              const v = e.target.value;
              e.currentTarget.value = "";
              if (!v) return;
              run(
                () =>
                  bulkUpdateItemsAction(campaignId, [...selected], {
                    placedBy: v === "__none__" ? "" : v,
                  }),
                "Přiřazení změněno",
              );
            }}
          >
            <option value="">Přiřadit komu…</option>
            <option value="__none__">— nikomu —</option>
            {placers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          </div>
          <div className="w-52">
          <select
            className={`${SELECT_CLS} ${CONTROL_H_SM} py-0 text-xs`}
            aria-label="Hromadně přesunout do oblasti"
            defaultValue=""
            onChange={(e) => {
              const v = e.target.value;
              e.currentTarget.value = "";
              if (!v) return;
              run(
                () =>
                  bulkUpdateItemsAction(campaignId, [...selected], {
                    areaId: v === "__none__" ? null : Number(v),
                  }),
                "Oblast změněna",
              );
            }}
          >
            <option value="">Přesunout do oblasti…</option>
            <option value="__none__">— bez oblasti —</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!confirmReset) {
                setConfirmReset(true);
                return;
              }
              setConfirmReset(false);
              run(
                () => resetScansAction(campaignId, [...selected]),
                "Počty naskenování vynulovány",
              );
            }}
            title="Smaže historii skenů i razítko „nalezeno“; „Nalezený“ se vrátí na „Schovaný“"
            className={`${CONTROL_H_SM} inline-flex items-center gap-1 rounded-md border px-2.5 font-medium transition ${
              confirmReset
                ? "border-amber-400 bg-amber-100 text-amber-900"
                : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            {confirmReset ? "Opravdu vynulovat?" : "Vynulovat skeny"}
          </button>
          <div className="w-52">
          <select
            className={`${SELECT_CLS} ${CONTROL_H_SM} py-0 text-xs`}
            aria-label="Hromadně zveřejnit nebo skrýt nápovědu"
            defaultValue=""
            onChange={(e) => {
              const v = e.target.value;
              e.currentTarget.value = "";
              if (!v) return;
              run(
                () =>
                  bulkUpdateItemsAction(campaignId, [...selected], {
                    hintPublished: v === "show",
                  }),
                v === "show" ? "Nápovědy odkryty" : "Nápovědy skryty",
              );
            }}
          >
            <option value="">Nápověda na webu…</option>
            <option value="show">Odkrýt</option>
            <option value="hide">Skrýt</option>
          </select>
          </div>
          <button
            type="button"
            onClick={() =>
              run(
                () => removeItemsAction(campaignId, [...selected]),
                "Kusy odebrány ze sady",
              )
            }
            className={`${CONTROL_H_SM} ml-auto inline-flex items-center gap-1 rounded-md border border-red-300 bg-white px-2.5 font-medium text-red-800 transition hover:bg-red-50`}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            Odebrat ze sady
          </button>
        </div>
      )}

      {error && (
        <p className="rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-900">
          {notice}
        </p>
      )}

      {/* ----------------------------------------------------- the grid */}
      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-sm text-gray-500">
          {items.length === 0
            ? "Sada zatím nemá žádné kusy."
            : "Filtru neodpovídá žádný kus."}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {shown.map((i) => (
            <ItemCard
              key={i.id}
              item={i}
              svg={svgs[i.id] ?? null}
              areaName={areas.find((a) => a.id === i.areaId)?.name ?? null}
              checked={selected.has(i.id)}
              onToggle={toggle}
              onOpen={openCard}
            />
          ))}
        </ul>
      )}

      {printing && (
        <DropPrintDialog
          itemIds={printing}
          campaignName={campaignName}
          onClose={() => setPrinting(null)}
        />
      )}

      {openItem && (
        <ItemDialog
          campaignId={campaignId}
          campaign={campaignDefaults}
          item={openItem}
          areas={areas}
          placers={placers}
          onClose={() => setOpenItem(null)}
          onSaved={() => {
            setOpenItem(null);
            router.refresh();
          }}
        />
      )}
    </section>
  );
}

/**
 * Memoised on purpose.
 *
 * A wave is 111 cards, each holding an inlined QR SVG of a few thousand
 * nodes. Without this, opening the edit dialog — a state change on the
 * grid — re-rendered every one of them, and the dialog took about a
 * second to appear on what is a purely client-side toggle.
 */
const ItemCard = memo(function ItemCard({
  item,
  svg,
  areaName,
  checked,
  onToggle,
  onOpen,
}: {
  item: ItemView;
  /** Pre-rendered by the grid's batched fetch; null until it arrives. */
  svg: string | null;
  areaName: string | null;
  checked: boolean;
  onToggle: (id: number) => void;
  onOpen: (item: ItemView) => void;
}) {
  return (
    <li
      className={`rounded-lg border p-2 transition ${
        checked ? "border-brand-400 bg-brand-50/60" : "border-gray-200 bg-white"
      }`}
    >
      <div className="flex items-center justify-between gap-1">
        <label className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-gray-900">
          <input
            type="checkbox"
            checked={checked}
            onChange={() => onToggle(item.id)}
            aria-label={`Vybrat nález ${item.findId}`}
            className="h-3.5 w-3.5 rounded border-gray-300 text-brand-600 focus:ring-brand-500/30"
          />
          🍀 #{item.findId}
        </label>
        <span
          className={`rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${STATUS_TONE[item.status]}`}
        >
          {DROP_STATUS_LABEL[item.status]}
        </span>
      </div>

      {/* The code is a picture, not a control: it is here to be looked
          at, and clicking a 4 cm QR to reach a form was a guessing game.
          Editing has its own button below. */}
      <div className="mt-2 rounded border border-gray-100 bg-gray-50 p-1">
        {svg ? (
          <div
            className="[&_svg]:block [&_svg]:h-auto [&_svg]:w-full"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <span className="flex aspect-square items-center justify-center text-gray-300">
            <QrCode className="h-8 w-8" aria-hidden />
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={() => onOpen(item)}
        className="mt-1.5 inline-flex w-full items-center justify-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 transition hover:border-brand-300 hover:bg-brand-50"
      >
        <Pencil className="h-3 w-3" aria-hidden />
        Upravit
      </button>

      <div className="mt-1.5 space-y-0.5 text-[10px] text-gray-500">
        <p className="truncate">
          {areaName ?? <span className="text-amber-700">bez oblasti</span>}
          {item.placedBy && <> · {item.placedBy}</>}
        </p>
        <p className="truncate">
          {item.lat !== null ? (
            <span className="font-mono">
              {item.lat.toFixed(4)}, {item.lng!.toFixed(4)}
            </span>
          ) : (
            <span className="text-amber-700">bez pozice</span>
          )}
        </p>
        <p className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1">
            <ScanLine className="h-3 w-3" aria-hidden />
            {item.scans}
          </span>
          <Link
            href={item.landingUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            title={item.landingUrl}
            className="inline-flex items-center gap-0.5 text-brand-700 hover:underline"
          >
            <ExternalLink className="h-3 w-3" aria-hidden />
            /d/
          </Link>
          {item.hintPublished && (
            <span className="text-emerald-700" title="Nápověda je zveřejněná">
              nápověda
            </span>
          )}
        </p>
        {item.overrides.length > 0 && (
          <p
            className="truncate text-brand-700"
            title={item.overrides.join(", ")}
          >
            vlastní: {item.overrides.join(", ")}
          </p>
        )}
      </div>
    </li>
  );
});
