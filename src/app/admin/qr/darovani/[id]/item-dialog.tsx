"use client";

import { useEffect, useState, useTransition } from "react";
import {
  Globe,
  Lightbulb,
  Loader2,
  QrCode,
  RotateCcw,
  Save,
  X,
} from "lucide-react";
import { saveItemAction } from "../../drop-actions";
import { DROP_STATUS_LABEL, DROP_STATUS_ORDER } from "@/lib/admin/dropVocab";
import { CONTROL_H, Field, INPUT_CLS, SELECT_CLS } from "../../qr-ui";
import { InheritedField } from "./inherited-field";
import { QrDesignFields, type QrDesign } from "./qr-design-fields";
import { QrLivePreview } from "./qr-live-preview";
import type { ItemView } from "./items-grid";

/**
 * Everything one card can override, in one place.
 *
 * Empty means "inherit the campaign" throughout — the placeholders say so
 * rather than pre-filling the campaign's text, because a pre-filled field
 * would silently turn into an override the moment it was saved.
 */
/** The campaign's text for every field a card may override. */
export interface CampaignDefaults {
  headingCs: string;
  headingEn: string;
  bodyCs: string;
  bodyEn: string;
  bonusCs: string;
  bonusEn: string;
  hintCs: string;
  hintEn: string;
  qrTitle: string;
  qrCaption: string;
  /** The wave's card design, already resolved — what an item inherits. */
  design: QrDesign;
}

/** Fields whose value is the campaign's until the card says otherwise. */
const INHERITED_KEYS = [
  "headingCs",
  "headingEn",
  "bodyCs",
  "bodyEn",
  "bonusCs",
  "bonusEn",
  "hintCs",
  "hintEn",
] as const;

export function ItemDialog({
  campaignId,
  campaign,
  sheetMode,
  pxPerCm,
  item,
  areas,
  placers,
  onClose,
  onSaved,
}: {
  campaignId: number;
  campaign: CampaignDefaults;
  /** True when a Google Sheet owns these fields — the form goes read-only
   *  rather than letting an edit survive until the next sync and vanish. */
  sheetMode: boolean;
  /** Screen calibration, so the preview is life-size. */
  pxPerCm: number;
  item: ItemView;
  areas: Array<{ id: number; name: string }>;
  placers: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(() => {
    // Seed every inherited field: the card's own value where it has one,
    // the campaign's otherwise. What goes BACK is decided on save, by
    // comparison — see the note in inherited-field.tsx.
    const inherited = Object.fromEntries(
      INHERITED_KEYS.map((k) => [k, item.detail[k] || campaign[k]]),
    ) as Record<(typeof INHERITED_KEYS)[number], string>;
    return {
      areaId: item.areaId === null ? "" : String(item.areaId),
      status: item.status as string,
      placedBy: item.placedBy ?? "",
      gps:
        item.lat !== null && item.lng !== null
          ? `${item.lat.toFixed(6)}, ${item.lng.toFixed(6)}`
          : "",
      ...inherited,
      teamNote: item.teamNote,
      hintPublished: item.hintPublished,
    };
  });

  // The look is a layer of its own: off means the card follows the wave,
  // on means the fields below are its override. Seeded from the campaign
  // so switching it on starts from what the card already looks like.
  const [ownDesign, setOwnDesign] = useState(item.hasOwnDesign);
  const [design, setDesign] = useState<QrDesign>(() => ({
    ...campaign.design,
    title: item.detail.qrTitle || campaign.qrTitle,
    caption: item.detail.qrCaption || campaign.qrCaption,
    ...item.ownDesign,
  }));
  const patchDesign = (patch: Partial<QrDesign>) =>
    setDesign((d) => ({ ...d, ...patch }));
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const overridden = INHERITED_KEYS.filter(
    (k) => form[k].trim() !== campaign[k].trim(),
  );
  const overriddenCount = overridden.length;

  const resetAllToCampaign = () =>
    setForm((f) => ({
      ...f,
      ...Object.fromEntries(INHERITED_KEYS.map((k) => [k, campaign[k]])),
    }));

  /** Equal to the campaign → stored empty, i.e. still inheriting. */
  const outbound = (k: (typeof INHERITED_KEYS)[number]) =>
    form[k].trim() === campaign[k].trim() ? "" : form[k];

  const save = () => {
    setError(null);
    start(async () => {
      const r = await saveItemAction(campaignId, item.id, {
        areaId: form.areaId === "" ? null : Number(form.areaId),
        status: form.status,
        placedBy: form.placedBy,
        gps: form.gps,
        headingCs: outbound("headingCs"),
        headingEn: outbound("headingEn"),
        bodyCs: outbound("bodyCs"),
        bodyEn: outbound("bodyEn"),
        bonusCs: outbound("bonusCs"),
        bonusEn: outbound("bonusEn"),
        qrTitle: ownDesign ? design.title : "",
        qrCaption: ownDesign ? design.caption : "",
        ownDesign,
        design,
        hintCs: outbound("hintCs"),
        hintEn: outbound("hintEn"),
        teamNote: form.teamNote,
        hintPublished: form.hintPublished,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onSaved();
    });
  };

  return (
    <div className="fixed inset-0 z-[1100] flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="my-8 w-full max-w-5xl space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              🍀 #{item.findId}
            </h3>
            <p className="mt-0.5 break-all font-mono text-[11px] text-gray-500">
              {item.landingUrl}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Zavřít"
            className="rounded p-1 text-gray-400 transition hover:bg-gray-100 disabled:opacity-40"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {sheetMode && (
          <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
            <strong>Tuhle sadu řídí Google Sheets.</strong> Co je v tabulce
            — texty, nápověda, stav, oblast, kdo umísťuje, GPS, titulek a
            podpis u QR a velikost tisku — je tady jen ke čtení; kdyby to
            šlo měnit, příští synchronizace by to přepsala.{" "}
            <strong>Vzhled kartičky v tabulce není</strong>, takže ten
            měnit jde a uloží se.
          </p>
        )}

        <fieldset disabled={sheetMode} className="contents">
        <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(15rem,1.4fr)]">
          <Field label="Oblast">
            <select
              className={`${SELECT_CLS} ${CONTROL_H}`}
              value={form.areaId}
              onChange={(e) => set("areaId", e.target.value)}
            >
              <option value="">— bez oblasti —</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Stav">
            <select
              className={`${SELECT_CLS} ${CONTROL_H}`}
              value={form.status}
              onChange={(e) => set("status", e.target.value)}
            >
              {DROP_STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {DROP_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Kdo umístí">
            <select
              className={`${SELECT_CLS} ${CONTROL_H}`}
              value={form.placedBy}
              onChange={(e) => set("placedBy", e.target.value)}
            >
              <option value="">— nikdo —</option>
              {placers.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
              {/* An imported name the roster doesn't know must stay
                  selectable, otherwise saving would silently drop it. */}
              {form.placedBy && !placers.includes(form.placedBy) && (
                <option value={form.placedBy}>
                  {form.placedBy} (mimo tým)
                </option>
              )}
            </select>
          </Field>
          <Field label="GPS úkrytu" hint="Desetinné stupně, DMS i odkaz z map.">
            <input
              className={`${INPUT_CLS} ${CONTROL_H} font-mono`}
              value={form.gps}
              onChange={(e) => set("gps", e.target.value)}
              placeholder="49.2245, 17.6712"
            />
          </Field>
        </div>

        <Field
          label="Poznámka týmu"
          hint="Kam kus přijde, kdo ho veme. Jen pro vás — na web se nedostane."
        >
          <textarea
            rows={2}
            className={`${INPUT_CLS} resize-y`}
            value={form.teamNote}
            onChange={(e) => set("teamNote", e.target.value)}
            placeholder="Za knihovnou, u třetí lavičky"
          />
        </Field>

        {/* -------------------------------------------- landing page */}
        <DialogGroup
          icon={<Globe className="h-4 w-4 text-sky-600" aria-hidden />}
          title="Stránka po naskenování QR"
          note="Co uvidí na mobilu ten, kdo tuhle kartičku najde. Předvyplněno textem sady — co přepíšeš, se označí jako upraveno a přestane sadu sledovat."
          action={
            overriddenCount > 0 ? (
              <button
                type="button"
                onClick={resetAllToCampaign}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 transition hover:bg-gray-50"
              >
                <RotateCcw className="h-3 w-3" aria-hidden />
                Vše ze sady ({overriddenCount})
              </button>
            ) : null
          }
        >
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <InheritedField
              label="Nadpis (česky)"
              value={form.headingCs}
              inherited={campaign.headingCs}
              onChange={(v) => set("headingCs", v)}
            />
            <InheritedField
              label="Nadpis (anglicky)"
              value={form.headingEn}
              inherited={campaign.headingEn}
              onChange={(v) => set("headingEn", v)}
            />
            <InheritedField
              label="Text (česky)"
              rows={5}
              value={form.bodyCs}
              inherited={campaign.bodyCs}
              onChange={(v) => set("bodyCs", v)}
            />
            <InheritedField
              label="Text (anglicky)"
              rows={5}
              value={form.bodyEn}
              inherited={campaign.bodyEn}
              onChange={(v) => set("bodyEn", v)}
            />
            <InheritedField
              label="Bonusový text (česky)"
              rows={3}
              value={form.bonusCs}
              inherited={campaign.bonusCs}
              onChange={(v) => set("bonusCs", v)}
            />
            <InheritedField
              label="Bonusový text (anglicky)"
              rows={3}
              value={form.bonusEn}
              inherited={campaign.bonusEn}
              onChange={(v) => set("bonusEn", v)}
            />
          </div>
        </DialogGroup>

        {/* The look of the card is NOT in the workbook — density, dot
            shape, colour, centre image, border and the per-card override
            live only here. So it stays editable while a sheet runs the
            wave; the fieldset closes around it and picks up after. */}
        </fieldset>

        {/* --------------------------------------------------- the card */}
        <DialogGroup
          icon={<QrCode className="h-4 w-4 text-emerald-600" aria-hidden />}
          title="Vzhled kartičky s QR kódem"
          note={
            ownDesign
              ? "Tahle kartička se tiskne po svém — na změny vzhledu sady už nereaguje."
              : "Kartička se tiskne podle sady. Zapni přepínač, jen když má vypadat jinak než zbytek vlny."
          }
          action={
            <label className="flex shrink-0 cursor-pointer items-center gap-2 text-[11px] font-medium text-gray-700">
              <input
                type="checkbox"
                checked={ownDesign}
                onChange={(e) => setOwnDesign(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-gray-300 text-brand-600 focus:ring-brand-500/30"
              />
              Vlastní vzhled
            </label>
          }
        >
          {ownDesign ? (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_13rem]">
              <QrDesignFields
                value={design}
                onChange={patchDesign}
                textPlaceholder="dědí ze sady"
                inheritedTitle={campaign.qrTitle}
                inheritedCaption={campaign.qrCaption}
              />
              <QrLivePreview
                design={design}
                findId={item.findId}
                label="Náhled této kartičky"
                pxPerCm={pxPerCm}
              />
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-[13rem_minmax(0,1fr)] sm:items-center">
              <QrLivePreview
                design={campaign.design}
                findId={item.findId}
                label="Podle sady"
                pxPerCm={pxPerCm}
              />
              <p className="text-xs text-gray-500">
                Takhle se tahle kartička vytiskne teď. Když v sadě změníš
                vzhled, změní se i tady.
              </p>
            </div>
          )}
        </DialogGroup>

        <fieldset disabled={sheetMode} className="contents">

        {/* --------------------------------------------------- the hint */}
        <DialogGroup
          icon={<Lightbulb className="h-4 w-4 text-amber-500" aria-hidden />}
          title="Nápověda k hledání"
          note="Kde hledat — ukáže se na detailu tohohle nálezu ve sbírce, ale jen když to zaškrtneš. NIKDY sem nepiš přesné souřadnice."
        >
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <InheritedField
              label="Nápověda (česky)"
              rows={2}
              value={form.hintCs}
              inherited={campaign.hintCs}
              onChange={(v) => set("hintCs", v)}
            />
            <InheritedField
              label="Nápověda (anglicky)"
              rows={2}
              value={form.hintEn}
              inherited={campaign.hintEn}
              onChange={(v) => set("hintEn", v)}
            />
          </div>
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-gray-800">
            <input
              type="checkbox"
              checked={form.hintPublished}
              onChange={(e) => set("hintPublished", e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500/30"
            />
            Zveřejnit nápovědu na detailu nálezu
          </label>
        </DialogGroup>

        </fieldset>

        {error && (
          <p className="rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
            {error}
          </p>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900 transition hover:bg-emerald-100 disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Save className="h-4 w-4" aria-hidden />
            )}
            Uložit kus
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-gray-500 underline-offset-2 hover:underline"
          >
            Zrušit
          </button>
          {item.foundAt && (
            <span className="ml-auto text-xs text-emerald-700">
              Nalezeno {item.foundAt}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** A labelled block inside the dialog, saying what its fields are FOR. */
function DialogGroup({
  icon,
  title,
  note,
  action,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  note: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          {icon}
          {title}
        </h4>
        {action}
      </div>
      <p className="mb-3 mt-0.5 max-w-3xl text-[11px] text-gray-500">{note}</p>
      {children}
    </div>
  );
}
