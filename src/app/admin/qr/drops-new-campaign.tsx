"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import { createCampaignAction, type CampaignInput } from "./drop-actions";
import { DROP_SIZE_DEFAULT_CM } from "@/lib/admin/dropVocab";
import { Field, INPUT_CLS } from "./qr-ui";

/** The crew as it stands — pre-filled so the first wave needs no typing.
 *  Editable per campaign afterwards; it is only a starting point. */
const DEFAULT_PLACERS = "Magďul + Pali\nMíša\nLeonka\nJá";

const EMPTY: CampaignInput = {
  name: "",
  note: "",
  headingCs: "Našel jsi čtyřlístek 🍀",
  headingEn: "You found a four-leaf clover 🍀",
  bodyCs: "",
  bodyEn: "",
  bonusCs: "",
  bonusEn: "",
  qrTitle: "",
  qrCaption: "",
  hintCs: "",
  hintEn: "",
  bgMode: "OFF",
  bgVariant: "MOSAIC",
  bgOpacity: "35",
  bgCardOpacity: "100",
  bgMobileVariant: "BY_FIND",
  design: {
    titleMode: "find",
    captionMode: "custom",
    sizeCm: String(DROP_SIZE_DEFAULT_CM),
    density: "medium",
    theme: "brand",
    moduleStyle: "clover",
    center: "smiley",
    centerScale: "md",
    border: "none",
    borderRadius: "soft",
    borderColor: "theme",
  },
  placers: DEFAULT_PLACERS,
};

export function NewCampaignButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState<CampaignInput>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const set = <K extends keyof CampaignInput>(k: K, v: CampaignInput[K]) =>
    setCfg((c) => ({ ...c, [k]: v }));

  const submit = () => {
    setError(null);
    start(async () => {
      const r = await createCampaignAction(cfg);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setOpen(false);
      setCfg(EMPTY);
      router.push(`/admin/qr/darovani/${r.id}`);
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-emerald-300 bg-white px-3 py-2 text-sm font-medium text-emerald-900 transition hover:bg-emerald-50"
      >
        <Plus className="h-4 w-4" aria-hidden />
        Nová sada
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="my-8 w-full max-w-2xl space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-sm font-semibold text-gray-900">Nová sada</h3>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Zavřít"
            className="rounded p-1 text-gray-400 transition hover:bg-gray-100"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <Field label="Název" hint="Např. „Vlna 2026“.">
          <input
            className={INPUT_CLS}
            value={cfg.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Vlna 2026"
          />
        </Field>
        <Field
          label="Poznámka (jen pro tebe)"
          hint="Filozofie akce, kolik kusů, proč. Na web se nedostane."
        >
          <textarea
            rows={2}
            className={`${INPUT_CLS} resize-y`}
            value={cfg.note}
            onChange={(e) => set("note", e.target.value)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nadpis (česky)">
            <input
              className={INPUT_CLS}
              value={cfg.headingCs}
              onChange={(e) => set("headingCs", e.target.value)}
            />
          </Field>
          <Field
            label="Nadpis (anglicky)"
            hint="Nepovinné — spadne na češtinu."
          >
            <input
              className={INPUT_CLS}
              value={cfg.headingEn}
              onChange={(e) => set("headingEn", e.target.value)}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Text (česky)" hint="Prázdný řádek = nový odstavec.">
            <textarea
              rows={5}
              className={`${INPUT_CLS} resize-y`}
              value={cfg.bodyCs}
              onChange={(e) => set("bodyCs", e.target.value)}
            />
          </Field>
          <Field label="Text (anglicky)">
            <textarea
              rows={5}
              className={`${INPUT_CLS} resize-y`}
              value={cfg.bodyEn}
              onChange={(e) => set("bodyEn", e.target.value)}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Bonusový text (česky)"
            hint="Zvýrazněný blok pod textem."
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

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Kdo rozmisťuje"
            hint="Jedno jméno na řádek. Vzhled kartičky nastavíš potom v sadě."
          >
            <textarea
              rows={4}
              className={`${INPUT_CLS} resize-y`}
              value={cfg.placers}
              onChange={(e) => set("placers", e.target.value)}
            />
          </Field>
        </div>

        {error && (
          <p className="rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900 transition hover:bg-emerald-100 disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Plus className="h-4 w-4" aria-hidden />
          )}
          Založit sadu
        </button>
      </div>
    </div>
  );
}
