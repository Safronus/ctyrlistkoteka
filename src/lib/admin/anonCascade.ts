import { prisma } from "@/lib/db";
import { setFindsAnonymized } from "@/lib/admin/findAnonymize";

export interface AnonCascadeResult {
  changed: boolean;
  /** Original photos renamed (pole 5 flipped); crops ride along. */
  photosRenamed: number;
  jsonAdded: number[];
  jsonRemoved: number[];
  errors: { findId: number; filename: string; error: string }[];
  /** Set when nothing was done — surfaced in the audit / caller log. */
  skipped?: string;
}

/**
 * Cascade a location-map anonymisation toggle to ALL of that location's
 * finds: rename their photo files (pole 5 in original + crop) and mirror
 * the IDs into `LokaceStavyPoznamky.json` `anonymizace.ANONYMIZOVANE`.
 *
 * Best-effort convenience so the filenames + JSON reflect reality.
 * `sync`'s `phaseMeta` enforces the identical rule independently (every
 * find on a location with any anonymised map is anonymised regardless), so
 * a skip/failure here NEVER leaks data — it only means the filenames/JSON
 * aren't updated until the next sync corrects the DB.
 *
 * De-anonymisation only reverts the finds when NO OTHER map of the same
 * location is still anonymised — a single anonymised map flags the whole
 * location (mirrors the public read rule + `checks.ts`).
 */
export async function cascadeMapAnon(
  originalFilename: string,
  anonymize: boolean,
): Promise<AnonCascadeResult> {
  const nothing = (skipped: string): AnonCascadeResult => ({
    changed: false,
    photosRenamed: 0,
    jsonAdded: [],
    jsonRemoved: [],
    errors: [],
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

  // On de-anonymise, keep the finds anonymised if any OTHER map of the
  // location is still flagged. This map's own DB flag is stale (the PNG was
  // just flipped, sync hasn't run) so it's excluded from the check.
  const locationStaysAnon = anonymize
    ? true
    : map.location.maps.some((m) => m.id !== map.id && m.isAnonymized);
  if (!anonymize && locationStaysAnon) return nothing("location-stays-anon");

  const finds = await prisma.find.findMany({
    where: { locationId: map.locationId },
    select: { id: true },
  });
  if (finds.length === 0) return nothing("no-finds");

  const bulk = await setFindsAnonymized(
    finds.map((f) => f.id),
    anonymize,
  );
  const changed =
    bulk.photosRenamed > 0 ||
    bulk.jsonAdded.length > 0 ||
    bulk.jsonRemoved.length > 0;
  return {
    changed,
    photosRenamed: bulk.photosRenamed,
    jsonAdded: bulk.jsonAdded,
    jsonRemoved: bulk.jsonRemoved,
    errors: bulk.errors,
    skipped: changed ? undefined : "no-op",
  };
}
