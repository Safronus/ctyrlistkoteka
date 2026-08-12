"use client";

import {
  DROP_CAPTION_MODE_LABEL,
  DROP_SIZE_MAX_CM,
  DROP_SIZE_MIN_CM,
  DROP_TITLE_MODE_LABEL,
  type DropCaptionMode,
  type DropTitleMode,
} from "@/lib/admin/dropVocab";
import { CONTROL_H, Field, INPUT_CLS, Seg } from "../../qr-ui";

/**
 * Everything that decides what a printed card LOOKS like.
 *
 * One component for both levels: the campaign sets the wave's look, an
 * item may override it. Keeping them identical is the point — a card
 * previewed in the grid has to be the card that comes out of the printer,
 * and two separate forms would drift.
 *
 * The title is a mode PLUS a text, not just a text. An empty field cannot
 * mean both "print the find number" and "print nothing", and until this
 * split existed there was no way to ask for a bare code.
 */

export interface QrDesign {
  titleMode: DropTitleMode;
  title: string;
  captionMode: DropCaptionMode;
  caption: string;
  sizeCm: string;
  density: string;
  theme: string;
  moduleStyle: string;
  center: string;
  centerScale: string;
  border: string;
  borderRadius: string;
  borderColor: string;
}

const TITLE_OPTS = (["find", "custom", "none"] as DropTitleMode[]).map((v) => ({
  v,
  l: DROP_TITLE_MODE_LABEL[v],
}));
const CAPTION_OPTS = (["custom", "none"] as DropCaptionMode[]).map((v) => ({
  v,
  l: DROP_CAPTION_MODE_LABEL[v],
}));

const DENSITY_OPTS = [
  { v: "dense", l: "Hustý", title: "Nejvyšší korekce chyb (H) — nejodolnější" },
  { v: "medium", l: "Střední", title: "Korekce Q" },
  { v: "compact", l: "Řídký", title: "Korekce M — nejmíň bodů, nejmíň odolný" },
];
const THEME_OPTS = [
  { v: "brand", l: "Zelený" },
  { v: "classic", l: "Černý" },
  { v: "dark", l: "Tmavý", title: "Světlé body na tmavém pozadí" },
];
const MODULE_OPTS = [
  { v: "clover", l: "Čtyřlístky" },
  { v: "square", l: "Čtverce" },
  { v: "dot", l: "Tečky" },
];
const CENTER_OPTS = [
  { v: "smiley", l: "Smajlík" },
  { v: "clover", l: "Čtyřlístek" },
  { v: "none", l: "Nic" },
];
const CENTER_SCALE_OPTS = [
  { v: "sm", l: "Menší" },
  { v: "md", l: "Větší" },
];
const BORDER_OPTS = [
  { v: "none", l: "Žádný" },
  { v: "frame", l: "Rámeček" },
  { v: "panel", l: "Podklad" },
  { v: "cut", l: "Střihací" },
];
const RADIUS_OPTS = [
  { v: "soft", l: "Jemné rohy" },
  { v: "round", l: "Kulaté rohy" },
];
const BORDER_COLOR_OPTS = [
  { v: "theme", l: "Barva motivu" },
  { v: "gray", l: "Šedá" },
];

/** Small heading that splits the panel into the questions it asks. */
function SubHead({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
      {children}
    </p>
  );
}

export function QrDesignFields({
  value,
  onChange,
  /** Placeholder for the text inputs — "dědí ze sady" inside an item. */
  textPlaceholder,
  /** Item level shows what the campaign would print instead. */
  inheritedTitle,
  inheritedCaption,
}: {
  value: QrDesign;
  onChange: (patch: Partial<QrDesign>) => void;
  textPlaceholder?: string;
  inheritedTitle?: string;
  inheritedCaption?: string;
}) {
  return (
    <div className="space-y-4">
      {/* Grouped by what the setting is ABOUT, because a flat two-column
          flow put "Hustota" next to "Barevnost" and "Okraj" under
          "Obrázek" purely by height — the panel read as scattered.
          Three questions: what is written on it, how the code looks, and
          how the card itself is cut. */}
      <SubHead>Texty na kartičce</SubHead>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field
          label="Nad QR kódem"
          hint={
            value.titleMode === "find"
              ? "Vytiskne se „🍀 #<číslo nálezu>“."
              : value.titleMode === "none"
                ? "Nad kódem nebude nic."
                : inheritedTitle
                  ? `Prázdné = „${inheritedTitle}“ ze sady.`
                  : "Vlastní text nad kódem."
          }
        >
          <div className="space-y-1.5">
            <Seg
              value={value.titleMode}
              onChange={(v) => onChange({ titleMode: v as DropTitleMode })}
              options={TITLE_OPTS}
            />
            {value.titleMode === "custom" && (
              <input
                className={`${INPUT_CLS} ${CONTROL_H}`}
                value={value.title}
                onChange={(e) => onChange({ title: e.target.value })}
                placeholder={textPlaceholder ?? "🍀 #30001"}
              />
            )}
          </div>
        </Field>

        <Field
          label="Pod QR kódem"
          hint={
            value.captionMode === "none"
              ? "Pod kódem nebude nic."
              : inheritedCaption
                ? `Prázdné = „${inheritedCaption}“ ze sady.`
                : "Prázdné = pod kódem nebude nic."
          }
        >
          <div className="space-y-1.5">
            <Seg
              value={value.captionMode}
              onChange={(v) => onChange({ captionMode: v as DropCaptionMode })}
              options={CAPTION_OPTS}
            />
            {value.captionMode === "custom" && (
              <input
                className={`${INPUT_CLS} ${CONTROL_H}`}
                value={value.caption}
                onChange={(e) => onChange({ caption: e.target.value })}
                placeholder={textPlaceholder ?? "ctyrlistkoteka.cz"}
              />
            )}
          </div>
        </Field>

      </div>

      <SubHead>Vzhled kódu</SubHead>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field
          label="Hustota kódu"
          hint="Hustší = víc bodů, ale snese víc poškození."
        >
          <Seg
            value={value.density}
            onChange={(v) => onChange({ density: v })}
            options={DENSITY_OPTS}
          />
        </Field>
        <Field label="Barevnost">
          <Seg
            value={value.theme}
            onChange={(v) => onChange({ theme: v })}
            options={THEME_OPTS}
          />
        </Field>
        <Field label="Tvar bodů">
          <Seg
            value={value.moduleStyle}
            onChange={(v) => onChange({ moduleStyle: v })}
            options={MODULE_OPTS}
          />
        </Field>
        <Field label="Obrázek uprostřed">
          <div className="flex flex-wrap items-center gap-2">
            <Seg
              value={value.center}
              onChange={(v) => onChange({ center: v })}
              options={CENTER_OPTS}
            />
            {value.center !== "none" && (
              <Seg
                value={value.centerScale}
                onChange={(v) => onChange({ centerScale: v })}
                options={CENTER_SCALE_OPTS}
              />
            )}
          </div>
        </Field>
      </div>

      <SubHead>Samotná kartička</SubHead>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field
          label="Velikost tisku"
          hint={`${DROP_SIZE_MIN_CM}–${DROP_SIZE_MAX_CM} cm, šířka kartičky. Náhled se jí drží.`}
        >
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={DROP_SIZE_MIN_CM}
              max={DROP_SIZE_MAX_CM}
              step={0.1}
              className={`${INPUT_CLS} ${CONTROL_H} w-24 tabular-nums`}
              value={value.sizeCm}
              onChange={(e) => onChange({ sizeCm: e.target.value })}
            />
            <span className="shrink-0 text-xs text-gray-500">cm</span>
          </div>
        </Field>
        <Field label="Okraj kartičky">
          <Seg
            value={value.border}
            onChange={(v) => onChange({ border: v })}
            options={BORDER_OPTS}
          />
        </Field>
        {value.border !== "none" && (
          <div className="sm:col-span-2">
          <Field label="Styl okraje">
            <div className="flex flex-wrap items-center gap-2">
              <Seg
                value={value.borderRadius}
                onChange={(v) => onChange({ borderRadius: v })}
                options={RADIUS_OPTS}
              />
              <Seg
                value={value.borderColor}
                onChange={(v) => onChange({ borderColor: v })}
                options={BORDER_COLOR_OPTS}
              />
            </div>
          </Field>
          </div>
        )}
      </div>
    </div>
  );
}
