"use client";

import dynamic from "next/dynamic";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MapPinOff, ScanLine, X } from "lucide-react";
import {
  setItemPositionAction,
  clearItemPositionAction,
} from "../../drop-actions";
import { DROP_STATUS_COLOR, DROP_STATUS_LABEL } from "@/lib/admin/dropVocab";
import { readBoundary } from "@/lib/admin/dropBoundary";
import { CONTROL_H_SM, SELECT_CLS } from "../../qr-ui";
import type { DropStatus } from "@/generated/prisma/enums";
import type { MapPoint } from "./drop-map";

/** Leaflet touches `window` at module load, so the map must stay out of
 *  the SSR bundle — same designated boundary the public /mapa uses. */
const DropMap = dynamic(() => import("./drop-map").then((m) => m.DropMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-[28rem] w-full items-center justify-center rounded-lg bg-gray-50 text-sm text-gray-400">
      Načítám mapu…
    </div>
  ),
});

export interface MapItem {
  id: number;
  findId: number;
  areaId: number | null;
  status: DropStatus;
  placedBy: string | null;
  lat: number | null;
  lng: number | null;
  scans: number;
  foundAt: string | null;
}

export interface MapArea {
  id: number;
  name: string;
  centerLat: number;
  centerLng: number;
  zoom: number;
  scatterRadiusM: number | null;
  boundary: unknown;
}

/**
 * The hiding-place map for one area at a time.
 *
 * Workflow it is built around: pick a card in the list, click where you
 * actually hid it. The list doubles as the "still to place" queue —
 * unplaced cards sort first, because those are the ones the walk is for.
 */
export function AreaMapPanel({
  campaignId,
  areas,
  items,
}: {
  campaignId: number;
  areas: MapArea[];
  items: MapItem[];
}) {
  const router = useRouter();
  const [areaId, setAreaId] = useState<number | null>(areas[0]?.id ?? null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const area = areas.find((a) => a.id === areaId) ?? null;

  const areaItems = useMemo(
    () => items.filter((i) => i.areaId === areaId),
    [items, areaId],
  );
  // Two queues, not one sorted list. A placed card used to sink to the
  // bottom of a single list, which is where "I clicked the wrong spot"
  // went to die — the point of the split is that fixing a position is as
  // reachable as making one.
  const todo = useMemo(
    () =>
      areaItems
        .filter((i) => i.lat === null)
        .sort((a, b) => a.findId - b.findId),
    [areaItems],
  );
  const placed = useMemo(
    () =>
      areaItems
        .filter((i) => i.lat !== null)
        .sort((a, b) => a.findId - b.findId),
    [areaItems],
  );

  const points: MapPoint[] = placed.map((i) => ({
    id: i.id,
    findId: i.findId,
    status: i.status,
    lat: i.lat!,
    lng: i.lng!,
    scans: i.scans,
    placedBy: i.placedBy,
  }));

  const selectedItem = areaItems.find((i) => i.id === selectedId) ?? null;

  const place = (lat: number, lng: number) => {
    if (selectedId === null) {
      setError("Nejdřív vyber kus v seznamu, pak klikni do mapy.");
      return;
    }
    setError(null);
    const wasPlaced = selectedItem?.lat !== null;
    start(async () => {
      const r = await setItemPositionAction(campaignId, selectedId, lat, lng);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      // Placing from the to-do queue walks on to the next one, so a whole
      // batch is click-list-once then click-map-click-map. MOVING an
      // already-placed card keeps it selected instead — you are usually
      // nudging the same card until it sits right.
      if (!wasPlaced) {
        const rest = todo.filter((i) => i.id !== selectedId);
        setSelectedId(rest[0]?.id ?? null);
      }
      router.refresh();
    });
  };

  const clear = (id: number) => {
    setError(null);
    start(async () => {
      const r = await clearItemPositionAction(campaignId, id);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setSelectedId(id); // it lands back in the to-do queue, still chosen
      router.refresh();
    });
  };

  if (areas.length === 0) {
    return (
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">Mapa úkrytů</h2>
        <p className="mt-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-6 text-center text-xs text-gray-500">
          Nejdřív přidej oblast — mapa se kreslí kolem jejího středu.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900">
          Mapa úkrytů{" "}
          <span className="font-normal text-xs text-gray-400">
            — jen v adminu, souřadnice se nikam ven nedostanou
          </span>
        </h2>
        <div className="w-48">
          <select
            className={`${SELECT_CLS} ${CONTROL_H_SM} py-0 text-xs`}
            aria-label="Oblast"
            value={areaId ?? ""}
            onChange={(e) => {
              setAreaId(Number(e.target.value));
              setSelectedId(null);
            }}
          >
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="text-xs text-gray-500">
        {selectedItem === null ? (
          <>Vyber kus v některém seznamu a klikni do mapy, kam patří.</>
        ) : (
          <>
            Vybraný kus{" "}
            <strong className="text-gray-900">🍀 #{selectedItem.findId}</strong>{" "}
            {selectedItem.lat === null
              ? "— klikni do mapy, kam jsi ho schoval."
              : "— klikni do mapy na novou pozici."}
          </>
        )}
      </p>

      {error && (
        <p className="rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
          {error}
        </p>
      )}

      <div className="grid gap-3 xl:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_minmax(0,14rem)]">
        <ItemQueue
          title="Bez pozice"
          count={todo.length}
          tone="amber"
          empty="Všechny kusy oblasti už pozici mají."
          items={todo}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />

        <div className="relative">
          {area && (
            <DropMap
              center={[area.centerLat, area.centerLng]}
              zoom={area.zoom}
              radiusM={area.scatterRadiusM}
              boundary={readBoundary(area.boundary)}
              points={points}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onPlace={place}
            />
          )}
          {busy && (
            <span className="pointer-events-none absolute right-3 top-3 z-[500] inline-flex items-center gap-1 rounded bg-white/90 px-2 py-1 text-xs text-gray-600 shadow">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ukládám
            </span>
          )}
        </div>

        <ItemQueue
          title="Umístěné"
          count={placed.length}
          tone="brand"
          empty="Zatím nic není v mapě."
          items={placed}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onClear={clear}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-500">
        {(["PREPARED", "PRINTED", "HIDDEN", "FOUND"] as DropStatus[]).map(
          (s) => (
            <span key={s} className="inline-flex items-center gap-1">
              <span
                aria-hidden
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: DROP_STATUS_COLOR[s] }}
              />
              {DROP_STATUS_LABEL[s]}
            </span>
          ),
        )}
        {selectedId !== null && (
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className="ml-auto inline-flex items-center gap-1 text-gray-500 underline-offset-2 hover:underline"
          >
            <X className="h-3 w-3" aria-hidden />
            Zrušit výběr
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * One side of the map: a list of cards you can pick from.
 *
 * Both queues use it, and the only difference is that the placed one
 * offers to take a position away again. Selecting is the same verb in
 * both — the map does not care which list a card came from.
 */
function ItemQueue({
  title,
  count,
  tone,
  empty,
  items,
  selectedId,
  onSelect,
  onClear,
}: {
  title: string;
  count: number;
  tone: "amber" | "brand";
  empty: string;
  items: MapItem[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  /** Present only on the placed queue. */
  onClear?: (id: number) => void;
}) {
  return (
    <div className="min-w-0">
      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        {title}
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] tabular-nums ${
            tone === "amber"
              ? "bg-amber-100 text-amber-900"
              : "bg-brand-100 text-brand-800"
          }`}
        >
          {count}
        </span>
      </p>
      <ul className="max-h-[26rem] space-y-1 overflow-y-auto pr-1">
        {items.length === 0 && (
          <li className="rounded border border-dashed border-gray-300 bg-gray-50 px-2 py-3 text-center text-[11px] text-gray-500">
            {empty}
          </li>
        )}
        {items.map((i) => (
          <li key={i.id} className="flex items-stretch gap-1">
            <button
              type="button"
              onClick={() => onSelect(i.id)}
              className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-md border px-2 py-1.5 text-left text-xs transition ${
                i.id === selectedId
                  ? "border-gray-900 bg-gray-100"
                  : "border-gray-200 bg-white hover:bg-gray-50"
              }`}
            >
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: DROP_STATUS_COLOR[i.status] }}
              />
              <span className="shrink-0 font-semibold text-gray-900">
                #{i.findId}
              </span>
              <span className="min-w-0 flex-1 truncate text-gray-500">
                {i.placedBy ?? DROP_STATUS_LABEL[i.status]}
              </span>
              {i.scans > 0 && (
                <span className="inline-flex shrink-0 items-center gap-0.5 text-gray-400">
                  <ScanLine className="h-3 w-3" aria-hidden />
                  {i.scans}
                </span>
              )}
            </button>
            {onClear && (
              <button
                type="button"
                onClick={() => onClear(i.id)}
                title={`Zrušit pozici kusu #${i.findId}`}
                aria-label={`Zrušit pozici kusu #${i.findId}`}
                className="shrink-0 rounded-md border border-gray-200 bg-white px-1.5 text-gray-400 transition hover:border-red-300 hover:text-red-700"
              >
                <MapPinOff className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
