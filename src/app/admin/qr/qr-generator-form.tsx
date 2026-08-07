"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Download, Plus } from "lucide-react";
import { QR_TARGETS } from "@/lib/admin/qrTargets";
import { centerFitsDensity, type QrDensity } from "@/lib/admin/qrDensity";
import { siteName } from "@/lib/siteName";
import { createQrAction, previewQrAction } from "./qr-actions";
import type { QrInput } from "./qr-types";
import { downloadPng, downloadSvg } from "./qr-download";
import { Field, Seg, Check, SELECT_CLS } from "./qr-ui";

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
const CENTER_OPTS = [
  { v: "clover", l: "Čtyřlístek" },
  { v: "smiley", l: "Smajlík" },
  { v: "none", l: "Žádný" },
];
const CENTER_SCALE_OPTS = [
  { v: "sm", l: "Menší" },
  { v: "md", l: "Větší" },
];
const DENSITY_OPTS = [
  {
    v: "dense",
    l: "Hustý",
    title: "Korekce H — 37×37 bodů, unese obrázek uprostřed",
  },
  {
    v: "medium",
    l: "Střední",
    title: "Korekce Q — 33×33 bodů, jen s menším obrázkem",
  },
  {
    v: "compact",
    l: "Kompaktní",
    title: "Korekce M — 29×29 bodů, bez obrázku uprostřed",
  },
];
const SIZE_OPTS = [
  { v: "sm", l: "Malý" },
  { v: "md", l: "Střední" },
  { v: "lg", l: "Velký" },
];
const BORDER_OPTS = [
  { v: "none", l: "Žádný" },
  { v: "frame", l: "Rámeček" },
  { v: "panel", l: "Pozadí" },
  { v: "cut", l: "Řezací linka" },
];
const RADIUS_OPTS = [
  { v: "soft", l: "Mírné" },
  { v: "round", l: "Kulaté" },
];
const BORDER_COLOR_OPTS = [
  { v: "theme", l: "Dle vzhledu" },
  { v: "gray", l: "Šedá" },
];
const PNG_SCALES = [1, 2, 4];

const DEFAULT_CFG: QrInput = {
  label: "",
  target: "home",
  locale: "cs",
  theme: "brand",
  moduleStyle: "clover",
  center: "clover",
  centerScale: "md",
  showTitle: true,
  titleText: "",
  showCaption: false,
  size: "md",
  border: "none",
  borderRadius: "soft",
  borderColor: "theme",
  density: "dense",
};

export function QrGeneratorForm() {
  const router = useRouter();
  const [cfg, setCfg] = useState<QrInput>(DEFAULT_CFG);
  const [previewSvg, setPreviewSvg] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pngScale, setPngScale] = useState(2);
  const [isCreating, startCreate] = useTransition();
  // The most recently created (trackable) QR — only this gets downloaded,
  // so everything you save lands in the evidence list below.
  const [created, setCreated] = useState<{
    token: string;
    svg: string;
  } | null>(null);

  const set = <K extends keyof QrInput>(key: K, value: QrInput[K]) =>
    setCfg((c) => ({ ...c, [key]: value }));

  // Debounced live preview (renders against the direct destination URL).
  const reqId = useRef(0);
  useEffect(() => {
    const id = ++reqId.current;
    const handle = setTimeout(async () => {
      setPreviewing(true);
      const r = await previewQrAction(cfg);
      if (id !== reqId.current) return; // a newer change superseded this
      if (r.ok) {
        setPreviewSvg(r.svg);
        setError(null);
      } else {
        setError(r.error);
      }
      setPreviewing(false);
    }, 250);
    return () => clearTimeout(handle);
  }, [cfg]);

  const onCreate = () => {
    setError(null);
    startCreate(async () => {
      const r = await createQrAction(cfg);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setCreated({ token: r.token, svg: r.svg });
      router.refresh(); // refresh the evidence list below
    });
  };

  const activeSvg = created?.svg ?? previewSvg;
  const fileBase = created ? `ctyrlistkoteka-qr-${created.token}` : null;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
      {/* ---------------------------------------------------- controls */}
      <div className="space-y-4">
        <Field label="Název QR kódu" hint="Pro evidenci — např. kam se nalepí.">
          <input
            type="text"
            value={cfg.label}
            maxLength={200}
            onChange={(e) => set("label", e.target.value)}
            placeholder="QR sbírky – vizitka"
            className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Cílová stránka">
            <select
              value={cfg.target}
              onChange={(e) => set("target", e.target.value)}
              className={SELECT_CLS}
            >
              {QR_TARGETS.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Jazyk odkazu">
            <Seg
              value={cfg.locale}
              onChange={(v) => set("locale", v)}
              options={[
                { v: "cs", l: "Česky" },
                { v: "en", l: "English" },
              ]}
            />
          </Field>
        </div>

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

        <Field
          label="Hustota bodů"
          hint="Méně bodů = větší (a lépe čitelné) body při stejné velikosti tisku, ale menší rezerva na poškození."
        >
          <Seg
            value={cfg.density}
            onChange={(v) => set("density", v)}
            options={DENSITY_OPTS}
          />
        </Field>
        {cfg.center !== "none" &&
          !centerFitsDensity(
            cfg.density as QrDensity,
            cfg.centerScale === "sm" ? "sm" : "md",
          ) && (
            <p className="rounded border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
              Při této hustotě se prostřední obrázek do kódu nevejde —
              vykousnuté body už nemá co dopočítat. Obrázek se proto vynechá.
            </p>
          )}

        <Field label="Velikost QR">
          <Seg
            value={cfg.size}
            onChange={(v) => set("size", v)}
            options={SIZE_OPTS}
          />
        </Field>

        <Field label="Okraj">
          <Seg
            value={cfg.border}
            onChange={(v) => set("border", v)}
            options={BORDER_OPTS}
          />
        </Field>
        {cfg.border !== "none" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Zaoblení rohů">
              <Seg
                value={cfg.borderRadius}
                onChange={(v) => set("borderRadius", v)}
                options={RADIUS_OPTS}
              />
            </Field>
            {cfg.border !== "panel" && (
              <Field label="Barva okraje">
                <Seg
                  value={cfg.borderColor}
                  onChange={(v) => set("borderColor", v)}
                  options={BORDER_COLOR_OPTS}
                />
              </Field>
            )}
          </div>
        )}

        <div className="space-y-2">
          <Check
            checked={cfg.showTitle}
            onChange={(b) => set("showTitle", b)}
            label="Zahrnout nadpis"
          />
          {cfg.showTitle && (
            <input
              type="text"
              value={cfg.titleText}
              maxLength={200}
              onChange={(e) => set("titleText", e.target.value)}
              placeholder={siteName(cfg.locale)}
              className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
          )}
          <Check
            checked={cfg.showCaption}
            onChange={(b) => set("showCaption", b)}
            label="Zobrazit čitelnou URL pod kódem"
          />
        </div>

        {error && (
          <p className="rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={onCreate}
          disabled={isCreating || !cfg.label.trim()}
          className="inline-flex items-center gap-1.5 rounded-md border border-brand-300 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-800 transition hover:border-brand-400 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isCreating ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Plus className="h-4 w-4" aria-hidden />
          )}
          Vytvořit QR kód
        </button>
        {!cfg.label.trim() && (
          <p className="text-xs text-gray-500">
            Vyplň název — vytvořením vznikne trackovaný kód v evidenci níže.
          </p>
        )}
      </div>

      {/* ----------------------------------------------------- preview */}
      <div className="space-y-3">
        <div className="relative flex min-h-[260px] items-center justify-center rounded-lg border border-gray-200 bg-gray-50 p-3">
          {previewing && !activeSvg ? (
            <Loader2
              className="h-6 w-6 animate-spin text-gray-400"
              aria-hidden
            />
          ) : activeSvg ? (
            <div
              className="mx-auto w-[300px] max-w-full [&_svg]:mx-auto [&_svg]:block [&_svg]:h-auto [&_svg]:w-full"
              dangerouslySetInnerHTML={{ __html: activeSvg }}
            />
          ) : (
            <span className="text-xs text-gray-400">Náhled…</span>
          )}
          {previewing && activeSvg && !created && (
            <Loader2
              className="absolute right-2 top-2 h-4 w-4 animate-spin text-gray-300"
              aria-hidden
            />
          )}
        </div>

        {created ? (
          <div className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
            <p className="font-medium">Vytvořeno a uloženo do evidence ✓</p>
            <p className="break-all font-mono text-[11px] text-emerald-800">
              /go/{created.token}
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <label className="inline-flex items-center gap-1 text-emerald-900">
                PNG ×
                <select
                  value={pngScale}
                  onChange={(e) => setPngScale(Number(e.target.value))}
                  className="rounded border border-emerald-300 bg-white px-1 py-0.5 text-emerald-900"
                >
                  {PNG_SCALES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() =>
                  fileBase && downloadSvg(created.svg, `${fileBase}.svg`)
                }
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 font-medium text-gray-700 transition hover:bg-gray-50"
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                SVG
              </button>
              <button
                type="button"
                onClick={() =>
                  fileBase &&
                  downloadPng(created.svg, `${fileBase}.png`, pngScale)
                }
                className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-white px-2.5 py-1 font-medium text-emerald-800 transition hover:bg-emerald-100"
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                PNG
              </button>
              <button
                type="button"
                onClick={() => setCreated(null)}
                className="ml-auto text-emerald-700 underline-offset-2 hover:underline"
              >
                Nový
              </button>
            </div>
          </div>
        ) : (
          <p className="text-center text-xs text-gray-400">
            Náhled je orientační. Stahování je dostupné po vytvoření
            (trackovaného) kódu.
          </p>
        )}
      </div>
    </div>
  );
}
