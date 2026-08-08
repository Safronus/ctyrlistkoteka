"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  Globe,
  Lightbulb,
  Loader2,
  QrCode,
  Save,
  Users,
} from "lucide-react";
import { updateCampaignAction, type CampaignInput } from "../../drop-actions";
import { Field, INPUT_CLS } from "../../qr-ui";
import { QrDesignFields, type QrDesign } from "./qr-design-fields";
import { QrLivePreview } from "./qr-live-preview";

/**
 * The wave's defaults, in the three groups they actually belong to.
 *
 * The grouping is the point. "Nadpis" and "Text" used to sit in one flat
 * list next to "Titulek na QR", and nothing on screen said that the first
 * two are read on a phone AFTER scanning while the third is printed on
 * the card itself — which is the single thing an operator has to keep
 * straight here.
 */
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

  const set = <K extends keyof CampaignInput>(k: K, v: CampaignInput[K]) => {
    setSaved(false);
    setCfg((c) => ({ ...c, [k]: v }));
  };

  const design: QrDesign = {
    ...cfg.design,
    title: cfg.qrTitle,
    caption: cfg.qrCaption,
  } as QrDesign;

  const setDesign = (patch: Partial<QrDesign>) => {
    setSaved(false);
    setCfg((c) => {
      const { title, caption, ...rest } = patch;
      return {
        ...c,
        qrTitle: title ?? c.qrTitle,
        qrCaption: caption ?? c.qrCaption,
        design: { ...c.design, ...rest },
      };
    });
  };

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
        Výchozí nastavení sady
        <span className="ml-2 font-normal text-xs text-gray-400">
          platí pro všechny kusy — jednotlivý kus si to může přepsat
        </span>
      </button>

      {open && (
        <div className="space-y-6 border-t border-gray-100 p-4">
          <div className="grid items-start gap-4 sm:grid-cols-2">
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

          {/* ------------------------------------------- landing page */}
          <Group
            icon={<Globe className="h-4 w-4 text-sky-600" aria-hidden />}
            title="Stránka po naskenování QR"
            note="Co uvidí na mobilu ten, kdo kartičku najde a naskenuje. Na kartičce samotné tyhle texty nejsou."
          >
            <div className="grid items-start gap-4 sm:grid-cols-2">
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
              <Field
                label="Bonusový text (česky)"
                hint="Zvláštní rámeček pod hlavním textem."
              >
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
          </Group>

          {/* ------------------------------------------------ the card */}
          <Group
            icon={<QrCode className="h-4 w-4 text-emerald-600" aria-hidden />}
            title="Vzhled kartičky s QR kódem"
            note="Co se fyzicky vytiskne a zalaminuje. Náhled vpravo je ten samý kód, jaký vyjde z tiskárny."
          >
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_13rem]">
              <QrDesignFields value={design} onChange={setDesign} />
              <QrLivePreview
                design={design}
                findId={30001}
                label="Náhled kartičky"
              />
            </div>
          </Group>

          {/* ----------------------------------------------- the hint */}
          <Group
            icon={<Lightbulb className="h-4 w-4 text-amber-500" aria-hidden />}
            title="Nápověda k hledání"
            note="Výchozí text pro celou sadu; u konkrétního kusu se dá přepsat na něco adresného. Zveřejňuje se ale vždy jen u toho kusu, kde to zaškrtneš — a jde vidět na detailu nálezu ve sbírce."
          >
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <Field
                label="Nápověda (česky)"
                hint="NIKDY sem nepiš přesné souřadnice."
              >
                <textarea
                  rows={2}
                  className={`${INPUT_CLS} resize-y`}
                  value={cfg.hintCs}
                  onChange={(e) => set("hintCs", e.target.value)}
                  placeholder="Hledej u laviček v parku."
                />
              </Field>
              <Field label="Nápověda (anglicky)">
                <textarea
                  rows={2}
                  className={`${INPUT_CLS} resize-y`}
                  value={cfg.hintEn}
                  onChange={(e) => set("hintEn", e.target.value)}
                />
              </Field>
            </div>
          </Group>

          {/* ------------------------------------------------ the crew */}
          <Group
            icon={<Users className="h-4 w-4 text-violet-500" aria-hidden />}
            title="Tým"
            note="Jména, ze kterých se vybírá u jednotlivých kusů."
          >
            <Field label="Kdo rozmisťuje" hint="Jedno jméno na řádek.">
              <textarea
                rows={4}
                className={`${INPUT_CLS} resize-y sm:max-w-sm`}
                value={cfg.placers}
                onChange={(e) => set("placers", e.target.value)}
              />
            </Field>
          </Group>

          {error && (
            <p className="rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
              {error}
            </p>
          )}
          {saved && !error && (
            <p className="rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-900">
              Uloženo. Změna se propíše do všech kusů, které si to nepřepsaly.
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

/** A labelled block that says what its fields are FOR. */
function Group({
  icon,
  title,
  note,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
        {icon}
        {title}
      </h3>
      <p className="mb-3 mt-0.5 max-w-3xl text-[11px] text-gray-500">{note}</p>
      {children}
    </div>
  );
}
