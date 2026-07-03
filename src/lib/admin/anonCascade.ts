import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";
import { atomicWrite, ensureDir, trashTimestamp } from "@/lib/admin/atomic";
import { formatJsonCompactArrays } from "@/lib/admin/jsonFormat";
import {
  LOKACE_STAVY_POZNAMKY_FILENAME,
  lokaceStavyPoznamkySchema,
} from "@/lib/admin/jsonSchema";
import { ADMIN_ROOTS } from "@/lib/admin/paths";
import { compactToRanges, parseRanges } from "@/lib/parseRanges";

const META_TARGET_PATH = path.join(
  ADMIN_ROOTS.meta,
  LOKACE_STAVY_POZNAMKY_FILENAME,
);

export interface AnonCascadeResult {
  changed: boolean;
  added: number[];
  removed: number[];
  /** Set when nothing was written — surfaced in the audit / caller log so
   *  a silent no-op is distinguishable from a genuine change. */
  skipped?: string;
}

/**
 * Mirror a location-map anonymisation toggle into
 * `LokaceStavyPoznamky.json`: add (turning ON) or remove (turning OFF)
 * that map's location's find IDs in `anonymizace.ANONYMIZOVANE`, then
 * atomic-write with the same `.trash` snapshot discipline as the editor.
 *
 * This is BEST-EFFORT convenience so the JSON reflects reality on the Mac.
 * `sync`'s `phaseMeta` enforces the identical rule independently (finds on
 * a location with any anonymised map are anonymised regardless of the
 * JSON), so a skip/failure here NEVER leaks data — it only means the JSON
 * isn't updated until the next sync corrects the DB.
 *
 * De-anonymisation removes the finds only when NO OTHER map of the same
 * location is still anonymised — a single anonymised map flags the whole
 * location (mirrors the public read rule + `checks.ts`).
 */
export async function cascadeMapAnonToJson(
  originalFilename: string,
  anonymize: boolean,
): Promise<AnonCascadeResult> {
  const nothing = (skipped: string): AnonCascadeResult => ({
    changed: false,
    added: [],
    removed: [],
    skipped,
  });

  const map = await prisma.locationMap.findFirst({
    where: { originalFilename },
    select: {
      id: true,
      locationId: true,
      location: {
        select: { maps: { select: { id: true, isAnonymized: true } } },
      },
    },
  });
  if (!map) return nothing("map-not-in-db");

  // After this toggle, should the location be treated as anonymised?
  //  - ON  → yes.
  //  - OFF → only if some OTHER map is still anonymised. This map's own DB
  //    flag is stale (the PNG was just flipped, sync hasn't run), so it's
  //    excluded from the check.
  const locationStaysAnon = anonymize
    ? true
    : map.location.maps.some((m) => m.id !== map.id && m.isAnonymized);

  const finds = await prisma.find.findMany({
    where: { locationId: map.locationId },
    select: { id: true },
  });
  if (finds.length === 0) return nothing("no-finds");
  const findIds = finds.map((f) => f.id);

  let raw: string;
  try {
    raw = await fs.readFile(META_TARGET_PATH, "utf8");
  } catch {
    return nothing("json-missing");
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return nothing("json-unparseable");
  }
  const result = lokaceStavyPoznamkySchema.safeParse(parsedJson);
  if (!result.success) return nothing("json-invalid");
  const data = result.data;

  const set = new Set(parseRanges(data.anonymizace.ANONYMIZOVANE));
  const added: number[] = [];
  const removed: number[] = [];
  for (const id of findIds) {
    if (locationStaysAnon) {
      if (!set.has(id)) {
        set.add(id);
        added.push(id);
      }
    } else if (set.has(id)) {
      set.delete(id);
      removed.push(id);
    }
  }
  if (added.length === 0 && removed.length === 0) {
    return nothing("already-in-sync");
  }

  data.anonymizace = {
    ...data.anonymizace,
    ANONYMIZOVANE: compactToRanges([...set].sort((a, b) => a - b)),
  };

  // Snapshot the current file into .trash before overwriting — same
  // discipline as the JSON editor, so a bad write is always recoverable.
  const trashDir = path.join(ADMIN_ROOTS.trash, trashTimestamp(), "meta");
  await ensureDir(trashDir);
  await fs.copyFile(
    META_TARGET_PATH,
    path.join(trashDir, LOKACE_STAVY_POZNAMKY_FILENAME),
  );

  await ensureDir(ADMIN_ROOTS.meta);
  await atomicWrite(META_TARGET_PATH, formatJsonCompactArrays(data) + "\n");

  return { changed: true, added, removed };
}
