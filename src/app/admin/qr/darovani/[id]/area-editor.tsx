"use client";

import dynamic from "next/dynamic";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  Globe2,
  Loader2,
  MapPin,
  Plus,
  Save,
  Shuffle,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  saveAreaAction,
  deleteAreaAction,
  scatterAreaAction,
  searchAreaBoundariesAction,
  applyAreaBoundaryAction,
  clearAreaBoundaryAction,
} from "../../drop-actions";
import type { BoundaryCandidate } from "@/lib/admin/dropNominatim";
import { parseGps } from "@/lib/parseGps";
import { readBoundary } from "@/lib/admin/dropBoundary";
import { CONTROL_H, CONTROL_H_SM, Field, INPUT_CLS, LABEL_H, ROW_CLS } from "../../qr-ui";
import { useRememberedOpen } from "../../use-remembered-open";
import { CrewMapFields } from "./crew-map-fields";

/** Leaflet reads `window` at module load — same SSR boundary the rest of
 *  the maps on this page use. */
const AreaPreviewMap = dynamic(
  () => import("./area-preview-map").then((m) => m.AreaPreviewMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[26rem] w-full items-center justify-center rounded-lg bg-gray-50 text-xs text-gray-400">
        Načítám mapu…
      </div>
    ),
  },
);

export interface AreaView {
  id: number;
  name: string;
  centerLat: number;
  centerLng: number;
  zoom: number;
  scatterRadiusM: number | null;
  /** GeoJSON outline from OSM, or null when the area has none yet. */
  boundary: unknown;
  boundaryLabel: string | null;
  itemCount: number;
  unplaced: number;
  /** Crew map (`/tym/<token>`): null when it has never been switched on.
   *  Admin-only page, so the password travels here in the clear — the
   *  operator has to be able to read it back to pass it on. */
  crewToken: string | null;
  crewPassword: string | null;
}

/** Areas are the towns a wave is spread across: each owns a map centre, a
 *  zoom and the radius the random scatter works within. */
export function AreaEditor({
  campaignId,
  areas,
  sheetMode,
  siteOrigin,
}: {
  campaignId: number;
  areas: AreaView[];
  /** Scatter writes positions, which a sheet-run wave owns. */
  sheetMode: boolean;
  /** Origin the crew-map links are built from. */
  siteOrigin: string;
}) {
  const [adding, setAdding] = useState(false);
  // Collapsed by default once the towns are set up: the section carries a
  // map per open row and is mostly read once per wave.
  const [open, toggleOpen] = useRememberedOpen(
    "drops.areas",
    areas.length === 0,
  );

  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <button
          type="button"
          onClick={() => toggleOpen()}
          aria-expanded={open}
          className="flex items-center gap-2 text-left text-sm font-semibold text-gray-900"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 text-gray-400" aria-hidden />
          ) : (
            <ChevronRight className="h-4 w-4 text-gray-400" aria-hidden />
          )}
          Oblasti
          <span className="font-normal text-xs text-gray-400">
            ({areas.length}
            {areas.length > 0 && ` · ${areas.map((a) => a.name).join(", ")}`})
          </span>
        </button>
        {open && (
          <button
            type="button"
            onClick={() => setAdding((a) => !a)}
            className={`${CONTROL_H_SM} inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50`}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Přidat oblast
          </button>
        )}
      </div>

      {open && (
      <div className="space-y-3 border-t border-gray-100 p-4">
      {areas.length === 0 && !adding && (
        <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-4 text-center text-xs text-gray-500">
          Zatím žádná oblast. Přidej třeba „Zlín“ se středem města.
        </p>
      )}

      <ul className="space-y-2">
        {areas.map((a) => (
          <AreaRow
            key={a.id}
            campaignId={campaignId}
            area={a}
            sheetMode={sheetMode}
            siteOrigin={siteOrigin}
          />
        ))}
      </ul>

      {adding && (
        <AreaRow
          campaignId={campaignId}
          area={null}
          siteOrigin={siteOrigin}
          onDone={() => setAdding(false)}
        />
      )}
      </div>
      )}
    </section>
  );
}

function AreaRow({
  campaignId,
  area,
  onDone,
  sheetMode,
  siteOrigin,
}: {
  campaignId: number;
  area: AreaView | null;
  onDone?: () => void;
  sheetMode?: boolean;
  siteOrigin: string;
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
  const [boundaryQuery, setBoundaryQuery] = useState(area?.name ?? "");
  const [candidates, setCandidates] = useState<BoundaryCandidate[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
    setNotice(null);
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
          <span
            className={`${CONTROL_H_SM} inline-flex shrink-0 items-center gap-1 rounded-md px-2 text-[11px] font-medium ${
              area.boundary
                ? "bg-teal-100 text-teal-900"
                : "bg-gray-200 text-gray-600"
            }`}
            title={area.boundaryLabel ?? "Hranice není stažená"}
          >
            <Globe2 className="h-3 w-3" aria-hidden />
            {area.boundary ? "hranice" : "bez hranice"}
          </span>
          {/* Coordinates on a reachable URL is the one state worth seeing
              without opening the row. */}
          {area.crewToken && (
            <span
              className={`${CONTROL_H_SM} inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-100 px-2 text-[11px] font-medium text-amber-900`}
              title="Mapa pro tým je zapnutá — odkaz je chráněný heslem"
            >
              <Users className="h-3 w-3" aria-hidden />
              mapa pro tým
            </span>
          )}
          <div className="flex shrink-0 items-center gap-1.5">
            {area.unplaced > 0 && area.scatterRadiusM != null && !sheetMode && (
              <button
                type="button"
                onClick={() =>
                  act(() => scatterAreaAction(campaignId, area.id))
                }
                disabled={busy}
                title="Rozhodit náhodně kusy bez pozice uvnitř poloměru"
                className={`${CONTROL_H_SM} inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 text-xs text-gray-700 transition hover:bg-gray-50 disabled:opacity-50`}
              >
                <Shuffle className="h-3.5 w-3.5" aria-hidden />
                Rozhodit ({area.unplaced})
              </button>
            )}
            <button
              type="button"
              onClick={() => setEditing(true)}
              className={`${CONTROL_H_SM} rounded-md border border-gray-300 bg-white px-2.5 text-xs text-gray-700 transition hover:bg-gray-50`}
            >
              Upravit
            </button>
            {confirmDel ? (
              <span className={`${CONTROL_H_SM} inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 text-xs text-red-900`}>
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
                className={`${CONTROL_H_SM} inline-flex items-center rounded-md border border-gray-300 bg-white px-2.5 text-gray-500 transition hover:bg-gray-50`}
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

        {/* Deliberately OUTSIDE the edit form: the link and the password
            are things the operator comes here to read and pass on, and a
            second "Uložit" inside a form that already has one is a coin
            toss about which button saves what. */}
        <div className="mt-3">
          <CrewMapFields
            campaignId={campaignId}
            areaId={area.id}
            areaName={area.name}
            token={area.crewToken}
            password={area.crewPassword}
            siteOrigin={siteOrigin}
          />
        </div>
      </li>
    );
  }

  // The preview follows what is TYPED, not what is saved — that is the
  // whole point of having it next to the form. Falls back to the stored
  // centre while the field is mid-edit and unparseable.
  const typedCenter = parseGps(center);
  const previewLat = typedCenter?.lat ?? area?.centerLat ?? null;
  const previewLng = typedCenter?.lng ?? area?.centerLng ?? null;
  const previewRadius =
    radius.trim() === "" ? null : Number(radius) || null;

  return (
    <li className="space-y-3 rounded-lg border border-brand-200 bg-brand-50/50 p-3">
      <div className={`${ROW_CLS} sm:grid-cols-4`}>
        <Field label="Název">
          <input
            className={`${INPUT_CLS} ${CONTROL_H}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Zlín"
          />
        </Field>
        <Field label="Střed" hint="Desetinné stupně, DMS i odkaz z Mapy.cz.">
          <input
            className={`${INPUT_CLS} ${CONTROL_H} font-mono`}
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
            className={`${INPUT_CLS} ${CONTROL_H} tabular-nums`}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </Field>
        <Field
          label="Poloměr rozhozu (m)"
          hint={
            area?.boundary
              ? "Záložní — rozhoz jde primárně do hranice."
              : "Prázdné = bez rozhozu."
          }
        >
          <input
            type="number"
            min={10}
            className={`${INPUT_CLS} ${CONTROL_H} tabular-nums`}
            value={radius}
            onChange={(e) => setRadius(e.target.value)}
            placeholder="2500"
          />
        </Field>
      </div>

      {/* ------------------------------------------------- town outline */}
      {area ? (
        <div className={`${ROW_CLS} sm:grid-cols-[minmax(0,1fr)_auto_auto]`}>
          <Field
            label="Hranice z OpenStreetMap"
            hint={
              area.boundaryLabel ??
              "Stáhne se jednou a uloží k oblasti; pak už se nikam nevolá."
            }
          >
            <input
              className={`${INPUT_CLS} ${CONTROL_H}`}
              value={boundaryQuery}
              onChange={(e) => setBoundaryQuery(e.target.value)}
              placeholder="Zlín, Česko"
            />
          </Field>
          <button
            type="button"
            onClick={() =>
              act(async () => {
                const r = await searchAreaBoundariesAction(
                  boundaryQuery || name,
                );
                if (r.ok) setCandidates(r.candidates);
                return r;
              })
            }
            disabled={busy}
            className={`${LABEL_H} ${CONTROL_H} inline-flex items-center gap-1.5 self-start rounded-md border border-teal-300 bg-teal-50 px-3 text-xs font-medium text-teal-900 transition hover:bg-teal-100 disabled:opacity-50`}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Globe2 className="h-3.5 w-3.5" aria-hidden />
            )}
            {area.boundary ? "Hledat znovu" : "Najít hranici"}
          </button>
          {area.boundary != null && (
            <button
              type="button"
              onClick={() =>
                act(() => clearAreaBoundaryAction(campaignId, area.id))
              }
              disabled={busy}
              title="Zahodit hranici — rozhoz se vrátí ke kruhu"
              className={`${LABEL_H} ${CONTROL_H} inline-flex items-center gap-1 self-start rounded-md border border-gray-300 bg-white px-2.5 text-xs text-gray-600 transition hover:bg-gray-50 disabled:opacity-50`}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              Zahodit
            </button>
          )}
        </div>
      ) : (
        <p className="rounded border border-dashed border-gray-300 bg-white/60 px-2.5 py-2 text-[11px] text-gray-500">
          Hranici města půjde stáhnout hned po uložení oblasti.
        </p>
      )}

      {candidates && (
        <div className="space-y-1.5 rounded-lg border border-teal-200 bg-teal-50/60 p-3">
          <p className="text-[11px] text-teal-900">
            OSM našel {candidates.length}{" "}
            {candidates.length === 1 ? "možnost" : "možností"} — vyber tu
            správnou. Nejmenší je nahoře, protože „Zlín“ je i kraj.
          </p>
          <ul className="space-y-1">
            {candidates.map((c, i) => (
              <li key={`${c.label}-${i}`}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      const r = await applyAreaBoundaryAction(
                        campaignId,
                        area!.id,
                        c.label,
                        c.geometry,
                      );
                      if (r.ok) {
                        setCandidates(null);
                        setNotice(`Hranice uložena: ${c.label}`);
                      }
                      return r;
                    })
                  }
                  className="flex w-full items-center gap-2 rounded-md border border-teal-200 bg-white px-2.5 py-1.5 text-left text-xs text-gray-800 transition hover:border-teal-400 hover:bg-teal-50 disabled:opacity-50"
                >
                  <span className="shrink-0 rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-900">
                    {c.kind}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{c.label}</span>
                  <span className="shrink-0 font-mono text-[10px] text-gray-400">
                    {c.vertices} bodů
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setCandidates(null)}
            className="text-[11px] text-gray-500 underline-offset-2 hover:underline"
          >
            Zavřít nabídku
          </button>
        </div>
      )}

      {previewLat !== null && previewLng !== null && (
        <AreaPreviewMap
          lat={previewLat}
          lng={previewLng}
          zoom={zoom}
          radiusM={previewRadius}
          boundary={readBoundary(area?.boundary)}
        />
      )}

      {notice && (
        <p className="rounded border border-teal-200 bg-teal-50 px-2 py-1 text-[11px] text-teal-900">
          {notice}
        </p>
      )}
      {error && (
        <p className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-800">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className={`${CONTROL_H_SM} inline-flex items-center gap-1.5 rounded-md border border-brand-300 bg-white px-2.5 text-xs font-medium text-brand-800 transition hover:bg-brand-100 disabled:opacity-50`}
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
