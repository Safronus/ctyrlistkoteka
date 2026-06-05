"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Download, Plus } from "lucide-react";
import { QR_TARGETS } from "@/lib/admin/qrTargets";
import { siteName } from "@/lib/siteName";
import { createQrAction, previewQrAction } from "./qr-actions";
import type { QrInput } from "./qr-types";
import { downloadPng, downloadSvg } from "./qr-download";

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
    setPreviewing(true);
    const handle = setTimeout(async () => {
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
              className="w-full max-w-[300px] [&_svg]:h-auto [&_svg]:w-full"
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
                onClick={() => fileBase && downloadSvg(created.svg, `${fileBase}.svg`)}
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 font-medium text-gray-700 transition hover:bg-gray-50"
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                SVG
              </button>
              <button
                type="button"
                onClick={() =>
                  fileBase && downloadPng(created.svg, `${fileBase}.png`, pngScale)
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

const SELECT_CLS =
  "w-full cursor-pointer rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm font-medium text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-700">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-gray-400">{hint}</span>}
    </label>
  );
}

function Seg({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { v: string; l: string }[];
}) {
  return (
    <div className="inline-flex flex-wrap overflow-hidden rounded-md border border-gray-300">
      {options.map((o, i) => {
        const active = o.v === value;
        return (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            aria-pressed={active}
            className={`px-2.5 py-1.5 text-xs font-medium transition ${
              i > 0 ? "border-l border-gray-300" : ""
            } ${
              active
                ? "bg-brand-600 text-white"
                : "bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            {o.l}
          </button>
        );
      })}
    </div>
  );
}

function Check({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (b: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-800">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500/30"
      />
      {label}
    </label>
  );
}
