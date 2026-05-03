import { prisma } from "@/lib/db";

/** Result of a single consistency check. The page renders one card
 *  per result; an empty `offenders` array is the green-check case. */
export interface CheckResult {
  id: string;
  /** Czech title for the card header. */
  title: string;
  /** One-sentence description of what the invariant says. */
  description: string;
  /** Per-row offenders. Each entry references a find id + a short
   *  context line (location code / name / "no location"). */
  offenders: CheckOffender[];
}

export interface CheckOffender {
  findId: number;
  /** Location code when the find has one; "—" otherwise. */
  locationCode: string;
  /** Human-readable label / explanation of the violation. */
  detail: string;
}

/** Returns the set of location ids that should be treated as
 *  anonymised — i.e. those with at least one LocationMap row whose
 *  PNG metadata flag was true at last sync. Mirrors the rule used by
 *  the public listLocations query (a single anonymised map flags the
 *  whole location, privacy-first). */
async function getAnonymizedLocationIds(): Promise<Set<number>> {
  const rows = await prisma.locationMap.findMany({
    where: { isAnonymized: true },
    select: { locationId: true },
    distinct: ["locationId"],
  });
  return new Set(rows.map((r) => r.locationId));
}

/** Loads a (id → code) lookup for the given location ids in one
 *  trip. Used to enrich offender rows with a human-readable label. */
async function loadLocationCodes(
  ids: readonly number[],
): Promise<Map<number, string>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.location.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, code: true },
  });
  return new Map(rows.map((r) => [r.id, r.code]));
}

/** Check 1 — every find sitting on an anonymised location must
 *  itself carry the anonymisation flag. The fix path is the new
 *  `setFindAnonymized` action: flip pole 5 from NE to ANO and add
 *  the id to JSON anonymizace. */
async function checkFindsInAnonLocsNotAnon(): Promise<CheckResult> {
  const anonLocIds = await getAnonymizedLocationIds();
  if (anonLocIds.size === 0) {
    return {
      id: "finds-in-anon-loc-not-anon",
      title: "Nálezy v anonymizované lokalitě bez anonymizace",
      description:
        "Každý nález v lokalitě s anonymizovanou mapou musí mít sám nastavenou anonymizaci (pole 5 = ANO).",
      offenders: [],
    };
  }
  const finds = await prisma.find.findMany({
    where: {
      locationId: { in: [...anonLocIds] },
      isAnonymized: false,
    },
    select: { id: true, locationId: true },
    orderBy: { id: "asc" },
  });
  const codes = await loadLocationCodes(
    finds.map((f) => f.locationId).filter((x): x is number => x !== null),
  );
  return {
    id: "finds-in-anon-loc-not-anon",
    title: "Nálezy v anonymizované lokalitě bez anonymizace",
    description:
      "Každý nález v lokalitě s anonymizovanou mapou musí mít sám nastavenou anonymizaci (pole 5 = ANO).",
    offenders: finds.map((f) => ({
      findId: f.id,
      locationCode:
        f.locationId !== null
          ? (codes.get(f.locationId) ?? `#${f.locationId}`)
          : "—",
      detail:
        "Lokalita má anonymizovanou mapu, ale nález není anonymizovaný.",
    })),
  };
}

/** Check 2 — inverse: every anonymised find should be in a location
 *  that's also anonymised. A find can in principle be anonymised in
 *  isolation, but the user wants this surfaced for review. */
async function checkAnonFindsInPublicLoc(): Promise<CheckResult> {
  const anonLocIds = await getAnonymizedLocationIds();
  const anonFinds = await prisma.find.findMany({
    where: { isAnonymized: true },
    select: { id: true, locationId: true },
    orderBy: { id: "asc" },
  });
  const offenders: CheckOffender[] = [];
  const idsForCodes: number[] = [];
  for (const f of anonFinds) {
    if (f.locationId === null) {
      offenders.push({
        findId: f.id,
        locationCode: "—",
        detail: "Nález je anonymizovaný, ale není přiřazený k žádné lokalitě.",
      });
      continue;
    }
    if (!anonLocIds.has(f.locationId)) {
      offenders.push({
        findId: f.id,
        locationCode: `#${f.locationId}`,
        detail:
          "Nález je anonymizovaný, ale lokalita anonymizovaná není.",
      });
      idsForCodes.push(f.locationId);
    }
  }
  if (idsForCodes.length > 0) {
    const codes = await loadLocationCodes(idsForCodes);
    for (const o of offenders) {
      if (o.locationCode.startsWith("#")) {
        const id = Number(o.locationCode.slice(1));
        const code = codes.get(id);
        if (code) o.locationCode = code;
      }
    }
  }
  return {
    id: "anon-finds-in-public-loc",
    title: "Anonymizované nálezy mimo anonymizovanou lokalitu",
    description:
      "Anonymizované nálezy by měly mít také anonymizovanou lokalitu — jinak je rozdíl jen mezi řádky a metadaty stránky lokality.",
    offenders,
  };
}

export async function runAllChecks(): Promise<CheckResult[]> {
  return Promise.all([
    checkFindsInAnonLocsNotAnon(),
    checkAnonFindsInPublicLoc(),
  ]);
}
