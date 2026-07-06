"use client";

import Link from "next/link";
import { NoteOverrideButton } from "../files/_shared/note-override-button";
import { setFindNoteOverride } from "../files/finds/note-override-action";
import { setMapNoteOverride } from "../files/maps/note-override-action";

export interface MissingEnRow {
  id: number;
  /** Original find filename / PNG map filename — the note editor posts it to
   *  resolve the id. Absent → no inline editor (fall back to Překlady). */
  filename?: string;
  /** Czech source shown in the row + seeded into the editor's CS field. */
  cs: string;
  locationCode: string;
}

/**
 * Offender table for the "missing EN" translation checks. Each row shows the
 * Czech note/caption and an inline "pozn." editor (the shared
 * NoteOverrideButton) pre-seeded with the CS text and an EMPTY English field
 * — so the operator types a real translation instead of accidentally saving
 * a Czech copy. Saving writes the override + refreshes, dropping the row.
 */
export function MissingEnOffenderTable({
  kind,
  rows,
}: {
  kind: "find" | "map";
  rows: MissingEnRow[];
}) {
  const action = kind === "find" ? setFindNoteOverride : setMapNoteOverride;
  const hint =
    kind === "find"
      ? "Doplň anglický překlad této poznámky nálezu. Uloží se jen EN do override vrstvy (čeština zůstává z názvu / LSP)."
      : "Doplň anglický překlad tohoto popisku mapy. Uloží se jen EN do override vrstvy (čeština zůstává z názvu).";
  const fileScope = kind === "find" ? "finds" : "maps";
  const idLabel = (id: number) =>
    kind === "map" ? `#${id.toString().padStart(5, "0")}` : `#${id}`;

  return (
    <div className="mt-4 max-h-96 overflow-auto rounded-md border border-amber-200 bg-white">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-gray-50 text-gray-600">
          <tr>
            <th className="px-2 py-1.5 text-left font-medium">
              {kind === "map" ? "ID mapy" : "ID nálezu"}
            </th>
            <th className="px-2 py-1.5 text-left font-medium">Lokalita</th>
            <th className="px-2 py-1.5 text-left font-medium">Česká poznámka</th>
            <th className="px-2 py-1.5 text-right font-medium">Přeložit</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-amber-50/40">
              <td className="px-2 py-1.5 align-top">
                {r.filename ? (
                  <Link
                    href={`/admin/files/${fileScope}/${encodeURIComponent(r.filename)}`}
                    className="font-mono tabular-nums text-brand-700 hover:underline"
                  >
                    {idLabel(r.id)}
                  </Link>
                ) : (
                  <span className="font-mono tabular-nums text-gray-700">
                    {idLabel(r.id)}
                  </span>
                )}
              </td>
              <td className="px-2 py-1.5 align-top font-mono text-gray-800">
                {r.locationCode}
              </td>
              <td className="px-2 py-1.5 align-top text-gray-600">{r.cs}</td>
              <td className="px-2 py-1.5 align-top text-right">
                {r.filename ? (
                  <NoteOverrideButton
                    filename={r.filename}
                    initialCs={r.cs}
                    initialEn=""
                    hasOverride={false}
                    action={action}
                    hint={hint}
                  />
                ) : (
                  <span
                    className="text-[11px] text-gray-400"
                    title="Soubor na disku nenalezen — uprav v sekci Překlady"
                  >
                    —
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
