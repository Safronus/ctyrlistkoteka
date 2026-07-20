import { FindState } from "@/generated/prisma/enums";
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

export interface NoteToTranslate {
  id: number;
  /** Public Czech source text (override.cs || finds.notes / map.description). */
  cs: string;
  /** Current EN override, if any. Included only by the "all" (review) export
   *  so bogus CS-copies (en === cs) and stale translations are visible and
   *  can be re-checked; absent from the default "missing only" export. */
  en?: string;
}

export interface NotesToTranslate {
  finds: NoteToTranslate[];
  maps: NoteToTranslate[];
}

/**
 * Every find note + map caption shown publicly, as CS source ready for
 * translation.
 *
 * @param opts.all When false (default) only entries that still LACK an EN
 *   override are returned, as `{ id, cs }`. When true EVERY entry with a CS
 *   source is returned, with its current `en` included — for a full review
 *   pass (an EN that just copies the CS, or a stale translation, is only
 *   visible this way).
 */
export async function collectNotesToTranslate(opts?: {
  all?: boolean;
}): Promise<NotesToTranslate> {
  const all = opts?.all ?? false;
  const [findOverrides, mapOverrides] = await Promise.all([
    readFindNoteOverrides(),
    readMapNoteOverrides(),
  ]);

  // Finds — public note = override.cs || notes. Match the find-detail note
  // gate: non-anonymized AND not donated. In "missing" mode skip rows that
  // already carry EN; in "all" mode keep them and surface the current EN.
  const findRows = await prisma.find.findMany({
    where: {
      isAnonymized: false,
      states: { none: { state: FindState.DONATED } },
    },
    select: { id: true, notes: true },
    orderBy: { id: "asc" },
  });
  const finds: NoteToTranslate[] = [];
  for (const r of findRows) {
    const ov = findOverrides.get(r.id);
    if (!all && ov?.en) continue;
    const cs = (ov?.cs ?? r.notes ?? "").trim();
    if (!cs) continue;
    finds.push(all && ov?.en ? { id: r.id, cs, en: ov.en } : { id: r.id, cs });
  }

  // Maps — public caption = override.cs || description. Non-anonymized only.
  const mapRows = await prisma.locationMap.findMany({
    where: { isAnonymized: false },
    select: { id: true, description: true },
    orderBy: { id: "asc" },
  });
  const maps: NoteToTranslate[] = [];
  for (const r of mapRows) {
    const ov = mapOverrides.get(r.id);
    if (!all && ov?.en) continue;
    const cs = (ov?.cs ?? r.description ?? "").trim();
    if (!cs) continue;
    maps.push(all && ov?.en ? { id: r.id, cs, en: ov.en } : { id: r.id, cs });
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
