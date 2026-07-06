import { FindState } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  getFindNoteOverride,
  readFindNoteOverrides,
  writeFindNoteOverride,
} from "@/lib/findNoteOverrides";
import {
  getMapNoteOverride,
  readMapNoteOverrides,
  writeMapNoteOverride,
} from "@/lib/mapNoteOverrides";

/**
 * Shared logic for the CZ→EN note/caption translation round-trip, used by
 * the /admin/translations download + upload endpoints.
 *
 * PRIVACY (CLAUDE.md §6): the export only surfaces text that is ALREADY
 * public on the site — anonymized + donated finds and anonymized maps are
 * excluded, so their notes never leave the box.
 */

export interface NotesToTranslate {
  /** Find id → its public Czech note (override.cs || finds.notes). */
  finds: { id: number; cs: string }[];
  /** Map id → its public Czech caption (override.cs || map.description). */
  maps: { id: number; cs: string }[];
}

/** Every find note + map caption shown publicly that still LACKS an English
 *  override, as CS source text ready for translation. */
export async function collectNotesToTranslate(): Promise<NotesToTranslate> {
  const [findOverrides, mapOverrides] = await Promise.all([
    readFindNoteOverrides(),
    readMapNoteOverrides(),
  ]);

  // Finds — public note = override.cs || notes. Match the find-detail note
  // gate: non-anonymized AND not donated. Skip rows already carrying EN.
  const findRows = await prisma.find.findMany({
    where: {
      isAnonymized: false,
      states: { none: { state: FindState.DONATED } },
    },
    select: { id: true, notes: true },
    orderBy: { id: "asc" },
  });
  const finds: { id: number; cs: string }[] = [];
  for (const r of findRows) {
    const ov = findOverrides.get(r.id);
    if (ov?.en) continue;
    const cs = (ov?.cs ?? r.notes ?? "").trim();
    if (cs) finds.push({ id: r.id, cs });
  }

  // Maps — public caption = override.cs || description. Non-anonymized only.
  const mapRows = await prisma.locationMap.findMany({
    where: { isAnonymized: false },
    select: { id: true, description: true },
    orderBy: { id: "asc" },
  });
  const maps: { id: number; cs: string }[] = [];
  for (const r of mapRows) {
    const ov = mapOverrides.get(r.id);
    if (ov?.en) continue;
    const cs = (ov?.cs ?? r.description ?? "").trim();
    if (cs) maps.push({ id: r.id, cs });
  }

  return { finds, maps };
}

/** Upload shape: `{ finds: { "16230": "English…" }, maps: { "55": "…" } }`. */
export interface TranslationImportInput {
  finds?: Record<string, string>;
  maps?: Record<string, string>;
}

export interface TranslationImportResult {
  finds: number;
  maps: number;
}

/** Merge EN translations into the override stores, setting ONLY `en` per id
 *  (an existing CS override is preserved; otherwise CS keeps tracking the
 *  filename / LSP source). Blank / non-string / non-integer entries are
 *  skipped. Returns how many of each were written. */
export async function applyNoteTranslations(
  data: TranslationImportInput,
): Promise<TranslationImportResult> {
  let finds = 0;
  for (const [k, en] of Object.entries(data.finds ?? {})) {
    const id = Number(k);
    if (!Number.isInteger(id) || typeof en !== "string" || !en.trim()) continue;
    const existing = await getFindNoteOverride(id);
    await writeFindNoteOverride(id, { cs: existing?.cs, en });
    finds++;
  }
  let maps = 0;
  for (const [k, en] of Object.entries(data.maps ?? {})) {
    const id = Number(k);
    if (!Number.isInteger(id) || typeof en !== "string" || !en.trim()) continue;
    const existing = await getMapNoteOverride(id);
    await writeMapNoteOverride(id, { cs: existing?.cs, en });
    maps++;
  }
  return { finds, maps };
}
