"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Download, RotateCcw } from "lucide-react";
import { centerFitsDensity, type QrDensity } from "@/lib/admin/qrDensity";
import {
  previewFindQrAction,
  resolveFindIdsAction,
  saveFindQrFormPrefsAction,
  resetFindQrFormPrefsAction,
} from "./find-qr-actions";
import type { FindQrInput } from "./qr-types";
import { CmCalibration, CmRuler } from "./cm-calibration";
import { Field, Seg, INPUT_CLS } from "./qr-ui";

const TITLE_OPTS = [
  { v: "id", l: "Číslo" },
  { v: "idDate", l: "Číslo + datum" },
  { v: "idLocation", l: "Číslo + lokalita" },
  { v: "none", l: "Bez titulku" },
];
const DENSITY_BASE = [
  {
    v: "dense",
    l: "Hustý",
    title: "Korekce H — nejvíc rezervy, unese obrázek uprostřed",
  },
  {
    v: "medium",
    l: "Střední",
    title: "Korekce Q — jen s menším obrázkem uprostřed",
  },
  {
    v: "compact",
    l: "Kompaktní",
    title: "Korekce M — nejmíň rezervy, bez obrázku uprostřed",
  },
];
const CENTER_OPTS = [
  { v: "smiley", l: "Smajlík" },
  { v: "clover", l: "Čtyřlístek" },
  { v: "none", l: "Žádný" },
];
const CENTER_SCALE_OPTS = [
  { v: "sm", l: "Menší" },
  { v: "md", l: "Větší" },
];
const THEME_OPTS = [
  { v: "brand", l: "Značková" },
  { v: "classic", l: "Klasická" },
  { v: "dark", l: "Tmavá" },
];
const MODULE_OPTS = [
  { v: "clover", l: "Čtyřlístky" },
  { v: "square", l: "Čtverce" },
  { v: "dot", l: "Puntíky" },
];
const BORDER_OPTS = [
  { v: "none", l: "Žádný" },
  { v: "frame", l: "Rámeček" },
  { v: "panel", l: "Pozadí" },
  { v: "cut", l: "Řezací linka" },
];

/** Printed module size below which phone cameras start to struggle.
 *  Rule of thumb from print practice, used only to colour the hint. */
const MODULE_MM_GOOD = 0.6;
const MODULE_MM_RISKY = 0.4;

export function FindQrForm({
  spec,
  onSpecChange,
  cfg,
  onCfgChange,
  sizeCm,
  onSizeCmChange,
  pxPerCm,
  calibrated,
  onExport,
}: {
  /** Number spec — shared with the list's checkboxes, see FindQrSection. */
  spec: string;
  onSpecChange: (v: string) => void;
  cfg: FindQrInput;
  onCfgChange: (v: FindQrInput) => void;
  sizeCm: number;
  onSizeCmChange: (v: number) => void;
  pxPerCm: number;
  calibrated: boolean;
  onExport: (ids: number[]) => void;
}) {
  const [svg, setSvg] = useState<string | null>(null);
  // Real module count per density for the previewed find's URL. A find
  // URL is short enough that "Střední" and "Kompaktní" often land on the
  // same size — showing the true numbers stops the operator paying error
  // correction for nothing.
  const [moduleCounts, setModuleCounts] = useState<Record<string, number>>({});
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<{
    found: number[];
    missing: number[];
  }>({ found: [], missing: [] });
  const [busy, startTransition] = useTransition();

  const set = <K extends keyof FindQrInput>(key: K, value: FindQrInput[K]) =>
    onCfgChange({ ...cfg, [key]: value });

  // Debounced resolve of the number spec against the DB. Every setState
  // lives inside the timeout — setting state straight from an effect body
  // costs a cascading render for no benefit here, since nothing is
  // observable before the debounce fires anyway.
  const specReq = useRef(0);
  useEffect(() => {
    const id = ++specReq.current;
    const handle = setTimeout(async () => {
      if (!spec.trim()) {
        setResolved({ found: [], missing: [] });
        setError(null);
        return;
      }
      const r = await resolveFindIdsAction(spec);
      if (id !== specReq.current) return;
      if (!r.ok) {
        setError(r.error);
        setResolved({ found: [], missing: [] });
        return;
      }
      setError(null);
      setResolved({ found: r.found, missing: r.missing });
    }, 300);
    return () => clearTimeout(handle);
  }, [spec]);

  // Remember the setup for next time. Debounced and fire-and-forget: a
  // failed save costs a re-pick, never a batch, so it must not interrupt
  // the operator with an error.
  useEffect(() => {
    const handle = setTimeout(() => {
      void saveFindQrFormPrefsAction(sizeCm, cfg);
    }, 800);
    return () => clearTimeout(handle);
  }, [cfg, sizeCm]);

  // Debounced preview of the FIRST resolved find (or a stand-in id).
  const previewReq = useRef(0);
  const firstId = resolved.found[0] ?? null;
  useEffect(() => {
    const id = ++previewReq.current;
    const handle = setTimeout(async () => {
      setPreviewing(true);
      const r = await previewFindQrAction(firstId, cfg);
      if (id !== previewReq.current) return;
      if (r.ok) {
        setSvg(r.svg);
        setModuleCounts(r.moduleCounts);
      }
      setPreviewing(false);
    }, 250);
    return () => clearTimeout(handle);
  }, [cfg, firstId]);

  const resetPrefs = () => {
    startTransition(async () => {
      const r = await resetFindQrFormPrefsAction();
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onCfgChange(r.form);
      onSizeCmChange(r.sizeCm);
    });
  };

  const density = cfg.density as QrDensity;
  const modules = modulesOf(svg) ?? moduleCounts[density] ?? 33;
  const densityOpts = DENSITY_BASE.map((o) => ({
    ...o,
    l: moduleCounts[o.v] ? `${o.l} · ${moduleCounts[o.v]}²` : o.l,
  }));
  const centerDropped =
    cfg.center !== "none" &&
    !centerFitsDensity(density, cfg.centerScale === "sm" ? "sm" : "md");

  // The printed picture is the QR plus padding and (optionally) a title,
  // so the QR itself is a fraction of the exported width. Measured off
  // the SVG rather than guessed, which keeps the module estimate honest
  // whatever the title wraps to.
  const qrFraction = svg ? qrWidthFraction(svg) : 0.9;
  const moduleMm = (sizeCm * 10 * qrFraction) / modules;
  const moduleTone =
    moduleMm >= MODULE_MM_GOOD
      ? "text-emerald-700"
      : moduleMm >= MODULE_MM_RISKY
        ? "text-amber-700"
        : "text-red-700";

  return (
    // 30rem fits the 12 cm maximum at CSS's nominal 37.8 px/cm without
    // scrolling; a calibrated high-DPI screen still overflows, which the
    // preview box handles by scrolling rather than shrinking.
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
      {/* ---------------------------------------------------- controls */}
      <div className="space-y-4">
        <Field
          label="Čísla nálezů"
          hint="Jednotlivá čísla, intervaly s pomlčkou a čárky — např. 1, 5-9, 12. Zaškrtávání v seznamu níže píše sem a naopak; čísla, která v seznamu ještě nejsou, se při stažení přidají."
        >
          <textarea
            value={spec}
            onChange={(e) => onSpecChange(e.target.value)}
            rows={2}
            placeholder="1, 5-9, 12"
            className={`${INPUT_CLS} resize-y font-mono`}
          />
        </Field>

        {error && (
          <p className="rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
            {error}
          </p>
        )}
        {resolved.found.length > 0 && (
          <p className="text-xs text-gray-600">
            <strong className="font-mono tabular-nums">
              {resolved.found.length.toLocaleString("cs-CZ")}
            </strong>{" "}
            {plural(resolved.found.length, "nález", "nálezy", "nálezů")} ke
            stažení
            {resolved.missing.length > 0 && (
              <span className="text-amber-700">
                {" "}
                · {resolved.missing.length}{" "}
                {plural(
                  resolved.missing.length,
                  "číslo neexistuje",
                  "čísla neexistují",
                  "čísel neexistuje",
                )}{" "}
                ({resolved.missing.slice(0, 8).join(", ")}
                {resolved.missing.length > 8 ? "…" : ""})
              </span>
            )}
          </p>
        )}

        <Field label="Titulek nad kódem">
          <Seg
            value={cfg.titleMode}
            onChange={(v) => set("titleMode", v as FindQrInput["titleMode"])}
            options={TITLE_OPTS}
          />
        </Field>

        <Field
          label="Hustota bodů"
          hint="Méně bodů = větší (a lépe čitelné) body při stejné velikosti tisku, ale menší rezerva na poškození."
        >
          <Seg
            value={cfg.density}
            onChange={(v) => set("density", v)}
            options={densityOpts}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Prostřední obrázek">
            <Seg
              value={cfg.center}
              onChange={(v) => set("center", v)}
              options={CENTER_OPTS}
            />
          </Field>
          {cfg.center !== "none" && (
            <Field label="Velikost obrázku">
              <Seg
                value={cfg.centerScale}
                onChange={(v) => set("centerScale", v)}
                options={CENTER_SCALE_OPTS}
              />
            </Field>
          )}
        </div>
        {centerDropped && (
          <p className="rounded border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
            Při této hustotě se prostřední obrázek do kódu nevejde — vykousnuté
            body už nemá co dopočítat. Obrázek se proto vynechá.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Vzhled (barvy)">
            <Seg
              value={cfg.theme}
              onChange={(v) => set("theme", v)}
              options={THEME_OPTS}
            />
          </Field>
          <Field label="Styl bodů">
            <Seg
              value={cfg.moduleStyle}
              onChange={(v) => set("moduleStyle", v)}
              options={MODULE_OPTS}
            />
          </Field>
        </div>

        <Field label="Okraj">
          <Seg
            value={cfg.border}
            onChange={(v) => set("border", v)}
            options={BORDER_OPTS}
          />
        </Field>

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={resetPrefs}
            disabled={busy}
            className="inline-flex items-center gap-1.5 text-[11px] text-gray-500 underline-offset-2 transition hover:text-gray-700 hover:underline disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            Zpět na výchozí nastavení
          </button>
          <span className="text-[11px] text-gray-400">
            (nastavení se pamatuje mezi návštěvami)
          </span>
        </div>
      </div>

      {/* -------------------------------------------- preview + export */}
      <div className="space-y-3">
        <Field
          label={`Velikost tisku — ${sizeCm.toFixed(1).replace(".", ",")} cm`}
          hint="Šířka celého obrázku po vytisknutí."
        >
          <input
            type="range"
            min={1.5}
            max={12}
            step={0.1}
            value={sizeCm}
            onChange={(e) => onSizeCmChange(Number(e.target.value))}
            className="w-full accent-brand-600"
          />
        </Field>

        {/* Scrolls rather than scaling: the whole point of a preview in
            centimetres is that it is 1:1, so shrinking it to fit would
            defeat the feature. */}
        <div className="min-h-[200px] overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 p-3">
          {previewing && !svg ? (
            <div className="flex h-[200px] items-center justify-center">
              <Loader2
                className="h-6 w-6 animate-spin text-gray-400"
                aria-hidden
              />
            </div>
          ) : svg ? (
            <div
              style={{ width: `${sizeCm * pxPerCm}px` }}
              className="[&_svg]:block [&_svg]:h-auto [&_svg]:w-full"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : (
            <span className="text-xs text-gray-400">Náhled…</span>
          )}
        </div>

        <CmRuler pxPerCm={pxPerCm} cm={Math.min(sizeCm, 10)} />
        <CmCalibration pxPerCm={pxPerCm} calibrated={calibrated} />

        <p className="text-xs text-gray-600">
          {modules}×{modules} bodů · bod ≈{" "}
          <strong className={`font-mono tabular-nums ${moduleTone}`}>
            {moduleMm.toFixed(2).replace(".", ",")} mm
          </strong>
        </p>
        <p className="text-[11px] text-gray-400">
          {moduleMm >= MODULE_MM_GOOD
            ? "Pohodlně čitelné běžným mobilem."
            : moduleMm >= MODULE_MM_RISKY
              ? "Na hraně — funguje zblízka a při dobrém tisku."
              : "Příliš malé — zvětši tisk nebo zvol kompaktnější kód."}
        </p>

        <button
          type="button"
          onClick={() => onExport(resolved.found)}
          disabled={resolved.found.length === 0}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-brand-300 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-800 transition hover:border-brand-400 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Download className="h-4 w-4" aria-hidden />
          Stáhnout{" "}
          {resolved.found.length > 0 ? `(${resolved.found.length})` : ""}
        </button>
        {resolved.found.length === 0 && (
          <p className="text-center text-xs text-gray-500">
            Zadej čísla nálezů nebo je zaškrtni v seznamu — pak se dá stáhnout
            balíček.
          </p>
        )}
      </div>
    </div>
  );
}

function modulesOf(svg: string | null): number | null {
  if (!svg) return null;
  const m = /<svg[^>]*\sdata-qr-modules="(\d+)"/.exec(svg);
  return m ? Number(m[1]) : null;
}

/** Fraction of the exported picture's width taken by the QR square
 *  itself — the renderer stamps both onto the SVG root (`data-qr-px` /
 *  `width`), so the printed module estimate stays exact even when a long
 *  title wraps and changes the card's proportions. */
function qrWidthFraction(svg: string): number {
  const total = Number(/<svg[^>]*\swidth="(\d+)"/.exec(svg)?.[1] ?? 0);
  const qrPx = Number(/<svg[^>]*\sdata-qr-px="(\d+)"/.exec(svg)?.[1] ?? 0);
  return total > 0 && qrPx > 0 ? qrPx / total : 0.9;
}

/** Czech 1 / 2–4 / 5+ plural. */
function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  if (n >= 2 && n <= 4) return few;
  return many;
}
