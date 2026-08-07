"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2, Save, X } from "lucide-react";
import { saveItemAction } from "../../drop-actions";
import {
  DROP_STATUS_LABEL,
  DROP_STATUS_ORDER,
  DROP_SIZE_MAX_CM,
  DROP_SIZE_MIN_CM,
} from "@/lib/admin/dropVocab";
import { Field, INPUT_CLS, SELECT_CLS } from "../../qr-ui";
import type { ItemView } from "./items-grid";

/**
 * Everything one card can override, in one place.
 *
 * Empty means "inherit the campaign" throughout — the placeholders say so
 * rather than pre-filling the campaign's text, because a pre-filled field
 * would silently turn into an override the moment it was saved.
 */
export function ItemDialog({
  campaignId,
  item,
  areas,
  placers,
  onClose,
  onSaved,
}: {
  campaignId: number;
  item: ItemView;
  areas: Array<{ id: number; name: string }>;
  placers: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    areaId: item.areaId === null ? "" : String(item.areaId),
    status: item.status as string,
    placedBy: item.placedBy ?? "",
    gps:
      item.lat !== null && item.lng !== null
        ? `${item.lat.toFixed(6)}, ${item.lng.toFixed(6)}`
        : "",
    ...item.detail,
    hintPublished: item.hintPublished,
  });
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

  const save = () => {
    setError(null);
    start(async () => {
      const r = await saveItemAction(campaignId, item.id, {
        areaId: form.areaId === "" ? null : Number(form.areaId),
        status: form.status,
        placedBy: form.placedBy,
        gps: form.gps,
        headingCs: form.headingCs,
        headingEn: form.headingEn,
        bodyCs: form.bodyCs,
        bodyEn: form.bodyEn,
        bonusCs: form.bonusCs,
        bonusEn: form.bonusEn,
        qrTitle: form.qrTitle,
        qrCaption: form.qrCaption,
        sizeCm: form.sizeCm,
        hintCs: form.hintCs,
        hintEn: form.hintEn,
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
      <div className="my-8 w-full max-w-3xl space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-xl">
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

        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Oblast">
            <select
              className={SELECT_CLS}
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
              className={SELECT_CLS}
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
              className={SELECT_CLS}
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
              className={`${INPUT_CLS} font-mono`}
              value={form.gps}
              onChange={(e) => set("gps", e.target.value)}
              placeholder="49.2245, 17.6712"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nadpis (česky)" hint="Prázdné = ze sady.">
            <input
              className={INPUT_CLS}
              value={form.headingCs}
              onChange={(e) => set("headingCs", e.target.value)}
              placeholder="dědí ze sady"
            />
          </Field>
          <Field label="Nadpis (anglicky)">
            <input
              className={INPUT_CLS}
              value={form.headingEn}
              onChange={(e) => set("headingEn", e.target.value)}
              placeholder="dědí ze sady"
            />
          </Field>
          <Field label="Text (česky)">
            <textarea
              rows={4}
              className={`${INPUT_CLS} resize-y`}
              value={form.bodyCs}
              onChange={(e) => set("bodyCs", e.target.value)}
              placeholder="dědí ze sady"
            />
          </Field>
          <Field label="Text (anglicky)">
            <textarea
              rows={4}
              className={`${INPUT_CLS} resize-y`}
              value={form.bodyEn}
              onChange={(e) => set("bodyEn", e.target.value)}
              placeholder="dědí ze sady"
            />
          </Field>
          <Field label="Bonusový text (česky)">
            <textarea
              rows={3}
              className={`${INPUT_CLS} resize-y`}
              value={form.bonusCs}
              onChange={(e) => set("bonusCs", e.target.value)}
              placeholder="dědí ze sady"
            />
          </Field>
          <Field label="Bonusový text (anglicky)">
            <textarea
              rows={3}
              className={`${INPUT_CLS} resize-y`}
              value={form.bonusEn}
              onChange={(e) => set("bonusEn", e.target.value)}
              placeholder="dědí ze sady"
            />
          </Field>
        </div>

        <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_10rem]">
          <Field label="Titulek nad QR" hint="Prázdné = ze sady.">
            <input
              className={INPUT_CLS}
              value={form.qrTitle}
              onChange={(e) => set("qrTitle", e.target.value)}
              placeholder="dědí ze sady"
            />
          </Field>
          <Field label="Text pod QR" hint="Prázdné = ze sady.">
            <input
              className={INPUT_CLS}
              value={form.qrCaption}
              onChange={(e) => set("qrCaption", e.target.value)}
              placeholder="dědí ze sady"
            />
          </Field>
          <Field label="Velikost tisku" hint="Prázdné = ze sady.">
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={DROP_SIZE_MIN_CM}
                max={DROP_SIZE_MAX_CM}
                step={0.1}
                className={`${INPUT_CLS} tabular-nums`}
                value={form.sizeCm}
                onChange={(e) => set("sizeCm", e.target.value)}
                placeholder="ze sady"
              />
              <span className="shrink-0 text-xs text-gray-500">cm</span>
            </div>
          </Field>
        </div>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Nápověda (česky)"
              hint="Kde hledat. NIKDY sem nepiš přesné souřadnice."
            >
              <textarea
                rows={2}
                className={`${INPUT_CLS} resize-y`}
                value={form.hintCs}
                onChange={(e) => set("hintCs", e.target.value)}
              />
            </Field>
            <Field label="Nápověda (anglicky)">
              <textarea
                rows={2}
                className={`${INPUT_CLS} resize-y`}
                value={form.hintEn}
                onChange={(e) => set("hintEn", e.target.value)}
              />
            </Field>
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
        </div>

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
