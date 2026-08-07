"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ExternalLink,
  Loader2,
  Plus,
  QrCode,
  ScanLine,
  Trash2,
} from "lucide-react";
import {
  addItemsAction,
  bulkUpdateItemsAction,
  removeItemsAction,
  renderDropQrAction,
} from "../../drop-actions";
import { DROP_STATUS_LABEL, DROP_STATUS_ORDER } from "@/lib/admin/dropVocab";
import type { DropStatus } from "@/generated/prisma/enums";
import { Field, INPUT_CLS, SELECT_CLS } from "../../qr-ui";
import { ItemDialog } from "./item-dialog";

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
 * The previews render lazily, one server call per card, so opening the
 * page doesn't rasterise a hundred codes up front.
 */
export function ItemsGrid({
  campaignId,
  items,
  areas,
  placers,
}: {
  campaignId: number;
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

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allShownChecked =
    shown.length > 0 && shown.every((i) => selected.has(i.id));

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
      router.refresh();
    });
  };

  return (
    <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-900">
        Kusy{" "}
        <span className="font-normal text-gray-400">
          ({items.length.toLocaleString("cs-CZ")})
        </span>
      </h2>

      {/* ------------------------------------------------------- adding */}
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <div className="min-w-[16rem] flex-1">
          <Field
            label="Přidat nálezy do sady"
            hint="Čísla a intervaly, např. 30001-30111. Musí už být ve sbírce."
          >
            <input
              className={`${INPUT_CLS} font-mono`}
              value={spec}
              onChange={(e) => setSpec(e.target.value)}
              placeholder="30001-30111"
            />
          </Field>
        </div>
        <div className="w-44">
          <Field label="Do oblasti">
            <select
              className={SELECT_CLS}
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
        </div>
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
          className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900 transition hover:bg-emerald-100 disabled:opacity-50"
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
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Hledat číslo"
          aria-label="Hledat podle čísla nálezu"
          className={`${INPUT_CLS} w-32 py-1 text-xs`}
        />
        <select
          className={`${SELECT_CLS} w-auto py-1 text-xs`}
          value={areaFilter}
          onChange={(e) => setAreaFilter(e.target.value)}
        >
          <option value="all">Všechny oblasti</option>
          <option value="none">Bez oblasti</option>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select
          className={`${SELECT_CLS} w-auto py-1 text-xs`}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">Všechny stavy</option>
          {DROP_STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {DROP_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
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
          className="rounded-md border border-gray-300 bg-white px-2 py-1 font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
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
          <select
            className={`${SELECT_CLS} w-auto py-1 text-xs`}
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
          <select
            className={`${SELECT_CLS} w-auto py-1 text-xs`}
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
          <select
            className={`${SELECT_CLS} w-auto py-1 text-xs`}
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
          <button
            type="button"
            onClick={() =>
              run(
                () => removeItemsAction(campaignId, [...selected]),
                "Kusy odebrány ze sady",
              )
            }
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-red-300 bg-white px-2 py-1 font-medium text-red-800 transition hover:bg-red-50"
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
              areaName={areas.find((a) => a.id === i.areaId)?.name ?? null}
              checked={selected.has(i.id)}
              onToggle={() => toggle(i.id)}
              onOpen={() => setOpenItem(i)}
            />
          ))}
        </ul>
      )}

      {openItem && (
        <ItemDialog
          campaignId={campaignId}
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

function ItemCard({
  item,
  areaName,
  checked,
  onToggle,
  onOpen,
}: {
  item: ItemView;
  areaName: string | null;
  checked: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const [svg, setSvg] = useState<string | null>(null);

  // Lazily: a hundred codes rendered on mount would be a hundred server
  // calls before the page is usable.
  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      const r = await renderDropQrAction(item.id);
      if (alive && r.ok) setSvg(r.svg);
    }, 50);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [item.id]);

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
            onChange={onToggle}
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

      <button
        type="button"
        onClick={onOpen}
        title="Upravit kus"
        className="mt-2 block w-full rounded border border-gray-100 bg-gray-50 p-1 transition hover:border-brand-300"
      >
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
}
