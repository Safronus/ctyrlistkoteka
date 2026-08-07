"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MapPin, Plus, Save, Shuffle, Trash2 } from "lucide-react";
import {
  saveAreaAction,
  deleteAreaAction,
  scatterAreaAction,
} from "../../drop-actions";
import { Field, INPUT_CLS } from "../../qr-ui";

export interface AreaView {
  id: number;
  name: string;
  centerLat: number;
  centerLng: number;
  zoom: number;
  scatterRadiusM: number | null;
  itemCount: number;
  unplaced: number;
}

/** Areas are the towns a wave is spread across: each owns a map centre, a
 *  zoom and the radius the random scatter works within. */
export function AreaEditor({
  campaignId,
  areas,
}: {
  campaignId: number;
  areas: AreaView[];
}) {
  const [adding, setAdding] = useState(false);

  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900">Oblasti</h2>
        <button
          type="button"
          onClick={() => setAdding((a) => !a)}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Přidat oblast
        </button>
      </div>

      {areas.length === 0 && !adding && (
        <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-4 text-center text-xs text-gray-500">
          Zatím žádná oblast. Přidej třeba „Zlín“ se středem města.
        </p>
      )}

      <ul className="space-y-2">
        {areas.map((a) => (
          <AreaRow key={a.id} campaignId={campaignId} area={a} />
        ))}
      </ul>

      {adding && (
        <AreaRow
          campaignId={campaignId}
          area={null}
          onDone={() => setAdding(false)}
        />
      )}
    </section>
  );
}

function AreaRow({
  campaignId,
  area,
  onDone,
}: {
  campaignId: number;
  area: AreaView | null;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(area === null);
  const [name, setName] = useState(area?.name ?? "");
  const [center, setCenter] = useState(
    area ? `${area.centerLat.toFixed(6)}, ${area.centerLng.toFixed(6)}` : "",
  );
  const [zoom, setZoom] = useState(area?.zoom ?? 14);
  const [radius, setRadius] = useState<string>(
    area?.scatterRadiusM != null ? String(area.scatterRadiusM) : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [busy, start] = useTransition();

  const save = () => {
    setError(null);
    start(async () => {
      const r = await saveAreaAction(campaignId, area?.id ?? null, {
        name,
        center,
        zoom,
        scatterRadiusM: radius.trim() === "" ? null : Number(radius),
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setEditing(false);
      onDone?.();
      router.refresh();
    });
  };

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Akce selhala");
      else {
        setConfirmDel(false);
        router.refresh();
      }
    });
  };

  if (!editing && area) {
    return (
      <li className="rounded-lg border border-gray-200 bg-gray-50 p-3">
        <div className="flex flex-wrap items-center gap-3">
          <MapPin className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900">{area.name}</p>
            <p className="truncate font-mono text-[11px] text-gray-500">
              {area.centerLat.toFixed(5)}, {area.centerLng.toFixed(5)} · zoom{" "}
              {area.zoom}
              {area.scatterRadiusM != null && (
                <> · rozhoz do {Math.round(area.scatterRadiusM)} m</>
              )}
            </p>
          </div>
          <p className="shrink-0 text-xs text-gray-600">
            {area.itemCount} kusů
            {area.unplaced > 0 && (
              <span className="ml-1 text-amber-700">
                ({area.unplaced} bez pozice)
              </span>
            )}
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            {area.unplaced > 0 && area.scatterRadiusM != null && (
              <button
                type="button"
                onClick={() =>
                  act(() => scatterAreaAction(campaignId, area.id))
                }
                disabled={busy}
                title="Rozhodit náhodně kusy bez pozice uvnitř poloměru"
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
              >
                <Shuffle className="h-3.5 w-3.5" aria-hidden />
                Rozhodit ({area.unplaced})
              </button>
            )}
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 transition hover:bg-gray-50"
            >
              Upravit
            </button>
            {confirmDel ? (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-900">
                Smazat? Kusy zůstanou, jen ztratí zařazení.
                <button
                  type="button"
                  onClick={() =>
                    act(() => deleteAreaAction(campaignId, area.id))
                  }
                  className="font-semibold underline-offset-2 hover:underline"
                >
                  Ano
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDel(false)}
                  className="underline-offset-2 hover:underline"
                >
                  Ne
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDel(true)}
                aria-label={`Smazat oblast ${area.name}`}
                className="rounded-md border border-gray-300 bg-white px-2 py-1 text-gray-500 transition hover:bg-gray-50"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
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

  return (
    <li className="rounded-lg border border-brand-200 bg-brand-50/50 p-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Název">
          <input
            className={INPUT_CLS}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Zlín"
          />
        </Field>
        <Field label="Střed" hint="Desetinné stupně, DMS i odkaz z Mapy.cz.">
          <input
            className={INPUT_CLS}
            value={center}
            onChange={(e) => setCenter(e.target.value)}
            placeholder="49.2245, 17.6712"
          />
        </Field>
        <Field label="Přiblížení">
          <input
            type="number"
            min={1}
            max={19}
            className={INPUT_CLS}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </Field>
        <Field label="Poloměr rozhozu (m)" hint="Prázdné = bez rozhozu.">
          <input
            type="number"
            min={10}
            className={INPUT_CLS}
            value={radius}
            onChange={(e) => setRadius(e.target.value)}
            placeholder="2500"
          />
        </Field>
      </div>
      {error && (
        <p className="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-800">
          {error}
        </p>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md border border-brand-300 bg-white px-2.5 py-1 text-xs font-medium text-brand-800 transition hover:bg-brand-100 disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Save className="h-3.5 w-3.5" aria-hidden />
          )}
          Uložit
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            onDone?.();
          }}
          className="text-xs text-gray-500 underline-offset-2 hover:underline"
        >
          Zrušit
        </button>
      </div>
    </li>
  );
}
