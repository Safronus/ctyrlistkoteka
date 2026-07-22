import {
  EyeOff,
  Ghost,
  ImageOff,
  Map as MapIcon,
  Users,
} from "lucide-react";
import { formatAreaM2 } from "@/lib/format";
import type { MapInventoryEntry } from "@/lib/admin/mapsV2";
import { NoteOverrideButton } from "../_shared/note-override-button";
import { setMapNoteOverride } from "./note-override-action";

const MAP_NOTE_HINT =
  "Zobrazí se jako popisek pod mapou (v detailu nálezu i lokality). Nezávislé na manifestu (ten se nemění). Předvyplněno popisem z manifestu; EN je podklad z češtiny — přelož ho. Prázdná obě pole = smazat override; prázdné EN = v EN se ukáže česky s upozorněním.";

/** The manifest's "no description" marker — treat as empty. */
const NO_DESCRIPTION = "BezPoznámky";

function cleanPopis(popis: string): string {
  const p = popis.trim();
  return p === NO_DESCRIPTION ? "" : p;
}

function indicatorText(entry: MapInventoryEntry): string {
  if (entry.indikator === "polygon") return "polygon (AOI)";
  if (entry.indikator === "radius") {
    return entry.radiusM !== null
      ? `kruh — poloměr ${entry.radiusM} m`
      : "kruh";
  }
  return "bod (bez plochy)";
}

/**
 * Metadata card for a **v2** location map, read straight from
 * `manifest.json` (the authoritative source) rather than parsed out of the
 * filename or PNG tEXt chunks. Replaces the v1 `MapMetadataPreview` on the
 * detail page for maps that live in the manifest, and hosts the web-caption
 * note-override editor (keyed by číslo). v2 maps are added / renamed / retired
 * as a whole via /admin/import — there are no per-file mutation controls here.
 */
export function MapV2Detail({
  entry,
  noteOverride,
}: {
  entry: MapInventoryEntry;
  noteOverride?: { cs?: string; en?: string };
}) {
  const rawPopis = cleanPopis(entry.popis);
  const cs = noteOverride?.cs ?? rawPopis;
  const en = noteOverride?.en ?? cs;
  const hasOverride = !!(noteOverride?.cs || noteOverride?.en);

  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-gray-900">
          <MapIcon className="h-4 w-4 text-brand-600" aria-hidden />
          Metadata mapy (verze 2, z manifestu)
        </h2>
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-medium">
          {entry.anonymized && (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-violet-800">
              <EyeOff className="h-3 w-3" aria-hidden />
              anonymizovaná
            </span>
          )}
          {entry.cancelled && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">
              <Ghost className="h-3 w-3" aria-hidden />
              zaniklá
            </span>
          )}
          {entry.isChild && (
            <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-sky-800">
              <Users className="h-3 w-3" aria-hidden />
              potomek
            </span>
          )}
          {entry.fileMissing && (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-rose-800">
              <ImageOff className="h-3 w-3" aria-hidden />
              chybí PNG
            </span>
          )}
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
        <Field label="Číslo (MAP_ID)">
          <span className="font-mono tabular-nums">
            {String(entry.cislo).padStart(5, "0")}
          </span>
        </Field>
        <Field label="Indikátor">{indicatorText(entry)}</Field>
        <Field label="Plocha">
          {entry.areaM2 !== null ? (
            <span className="font-mono tabular-nums">
              {formatAreaM2(entry.areaM2)}
            </span>
          ) : (
            <span className="text-gray-400">—</span>
          )}
        </Field>
        <Field label="GPS střed">
          <span className="font-mono tabular-nums">
            {entry.gpsLat.toFixed(5)}°, {entry.gpsLon.toFixed(5)}°
          </span>
        </Field>
        <Field label="Kód lokality" wide>
          <span className="break-words font-mono">{entry.code}</span>
        </Field>
        <Field label="Popis (manifest)" wide>
          {rawPopis ? (
            <span className="break-words">{rawPopis}</span>
          ) : (
            <span className="text-gray-400">—</span>
          )}
        </Field>
        <Field label="Město / stát">
          {entry.mesto}, {entry.stat}
        </Field>
        {entry.geoAddress && (
          <Field label="Adresa" wide>
            <span className="break-words">{entry.geoAddress}</span>
          </Field>
        )}
        {entry.parentCode && (
          <Field label="Rodič (potomek)" wide>
            <span className="break-words font-mono">{entry.parentCode}</span>
          </Field>
        )}
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3">
        <div className="text-[11px] text-gray-500">
          Webový popisek pod mapou (nezávislý na manifestu):
        </div>
        <NoteOverrideButton
          filename={entry.nosnaName}
          initialCs={cs}
          initialEn={en}
          hasOverride={hasOverride}
          action={setMapNoteOverride}
          hint={MAP_NOTE_HINT}
        />
      </div>
    </section>
  );
}

function Field({
  label,
  wide,
  children,
}: {
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <dt className="text-[10px] uppercase tracking-wide text-gray-400">
        {label}
      </dt>
      <dd className="mt-0.5 text-gray-800">{children}</dd>
    </div>
  );
}
