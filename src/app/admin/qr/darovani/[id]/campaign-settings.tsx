"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Loader2, Save } from "lucide-react";
import { updateCampaignAction, type CampaignInput } from "../../drop-actions";
import {
  DROP_SIZE_DEFAULT_CM,
  DROP_SIZE_MAX_CM,
  DROP_SIZE_MIN_CM,
} from "@/lib/admin/dropVocab";
import { Field, INPUT_CLS } from "../../qr-ui";

/** Campaign-wide defaults: the message every card inherits unless it
 *  overrides it, plus the crew roster the item dropdowns are built from. */
export function CampaignSettings({
  campaignId,
  initial,
}: {
  campaignId: number;
  initial: CampaignInput;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState<CampaignInput>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, start] = useTransition();

  const set = <K extends keyof CampaignInput>(k: K, v: CampaignInput[K]) =>
    setCfg((c) => ({ ...c, [k]: v }));

  const save = () => {
    setError(null);
    setSaved(false);
    start(async () => {
      const r = await updateCampaignAction(campaignId, cfg);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-gray-900 transition hover:bg-gray-50"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 text-gray-400" aria-hidden />
        ) : (
          <ChevronRight className="h-4 w-4 text-gray-400" aria-hidden />
        )}
        Texty sady a tým
        <span className="ml-2 font-normal text-xs text-gray-400">
          výchozí pro všechny kusy — kus si je může přepsat
        </span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-gray-100 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Název sady">
              <input
                className={INPUT_CLS}
                value={cfg.name}
                onChange={(e) => set("name", e.target.value)}
              />
            </Field>
            <Field label="Poznámka (jen pro tebe)">
              <input
                className={INPUT_CLS}
                value={cfg.note}
                onChange={(e) => set("note", e.target.value)}
              />
            </Field>
          </div>

          <div className="grid items-start gap-x-4 gap-y-4 sm:grid-cols-2">
            <Field label="Nadpis (česky)">
              <input
                className={INPUT_CLS}
                value={cfg.headingCs}
                onChange={(e) => set("headingCs", e.target.value)}
              />
            </Field>
            <Field label="Nadpis (anglicky)">
              <input
                className={INPUT_CLS}
                value={cfg.headingEn}
                onChange={(e) => set("headingEn", e.target.value)}
              />
            </Field>
            <Field label="Text (česky)" hint="Prázdný řádek = nový odstavec.">
              <textarea
                rows={6}
                className={`${INPUT_CLS} resize-y`}
                value={cfg.bodyCs}
                onChange={(e) => set("bodyCs", e.target.value)}
              />
            </Field>
            <Field label="Text (anglicky)">
              <textarea
                rows={6}
                className={`${INPUT_CLS} resize-y`}
                value={cfg.bodyEn}
                onChange={(e) => set("bodyEn", e.target.value)}
              />
            </Field>
            <Field label="Bonusový text (česky)">
              <textarea
                rows={3}
                className={`${INPUT_CLS} resize-y`}
                value={cfg.bonusCs}
                onChange={(e) => set("bonusCs", e.target.value)}
              />
            </Field>
            <Field label="Bonusový text (anglicky)">
              <textarea
                rows={3}
                className={`${INPUT_CLS} resize-y`}
                value={cfg.bonusEn}
                onChange={(e) => set("bonusEn", e.target.value)}
              />
            </Field>
          </div>

          {/* Card print settings — their own strip, because they describe
              the physical object rather than the landing page above. */}
          <div className="grid items-start gap-x-4 gap-y-4 rounded-lg border border-gray-200 bg-gray-50 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_10rem]">
            <Field
              label="Titulek nad QR"
              hint="Prázdné = „🍀 #<číslo>“ podle nálezu."
            >
              <input
                className={INPUT_CLS}
                value={cfg.qrTitle}
                onChange={(e) => set("qrTitle", e.target.value)}
              />
            </Field>
            <Field
              label="Text pod QR"
              hint="Prázdné = pod kódem není nic."
            >
              <input
                className={INPUT_CLS}
                value={cfg.qrCaption}
                onChange={(e) => set("qrCaption", e.target.value)}
                placeholder="např. ctyrlistkoteka.cz"
              />
            </Field>
            <Field label="Velikost tisku" hint={`${DROP_SIZE_MIN_CM}–${DROP_SIZE_MAX_CM} cm, šířka kartičky.`}>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={DROP_SIZE_MIN_CM}
                  max={DROP_SIZE_MAX_CM}
                  step={0.1}
                  className={`${INPUT_CLS} tabular-nums`}
                  value={cfg.sizeCm}
                  onChange={(e) => set("sizeCm", e.target.value)}
                  placeholder={String(DROP_SIZE_DEFAULT_CM)}
                />
                <span className="shrink-0 text-xs text-gray-500">cm</span>
              </div>
            </Field>
          </div>

          <Field label="Kdo rozmisťuje" hint="Jedno jméno na řádek.">
            <textarea
              rows={4}
              className={`${INPUT_CLS} resize-y sm:max-w-sm`}
              value={cfg.placers}
              onChange={(e) => set("placers", e.target.value)}
            />
          </Field>

          {error && (
            <p className="rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
              {error}
            </p>
          )}
          {saved && !error && (
            <p className="rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-900">
              Uloženo. Změna se propíše do všech kusů, které si text nepřepsaly.
            </p>
          )}

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
            Uložit sadu
          </button>
        </div>
      )}
    </section>
  );
}
