import { z } from "zod";
import { FindState } from "@/generated/prisma/enums";
import { parseFindFilename } from "@/lib/parseFilename";
import { compactToRanges, parseRanges } from "@/lib/parseRanges";
import { JSON_STATE_MAP } from "@/lib/stateMapping";
import {
  lokaceSchema,
  lokaceStavyPoznamkySchema,
  poznamkySchema,
  rangesField,
  type LokaceStavyPoznamky,
} from "@/lib/admin/jsonSchema";

/**
 * The "oprava-nalezu" package — a correction of finds that are ALREADY on
 * the site (state, note, anonymisation, location, photos), sent by the
 * desktop app, which is the single source of truth for them.
 *
 * Contract: the desktop repo's `docs/WEB_aktualizace_nalezu.md` (revision 2,
 * approved 2026-10-28). Shape of the zip:
 *
 *     manifest.json                     "typ": "oprava-nalezu"
 *     meta/LokaceStavyPoznamky.json     excerpt = full truth for the listed finds
 *     finds/<composed name>.jpg         original
 *     crops/<composed name>.jpg         crop
 *
 * What makes it different from the ordinary package (which only ADDS to the
 * LSP and can't remove a state, un-anonymise, change a note or move a find):
 * for every find in the manifest, the desktop-owned parts of the LSP are
 * REPLACED by the excerpt — whatever the excerpt doesn't say about that find
 * is removed. `stavy.GIGANT` is the web's own (an admin toggle) and the
 * desktop never sends it, so a key absent from the excerpt is left alone.
 *
 * This module is pure (no disk, no database): the importer gathers what the
 * site knows and hands it in, so every rule below is testable on its own.
 */

export const FIND_UPDATE_TYP = "oprava-nalezu";
export const FIND_UPDATE_SCHEMA_VERSION = 1;
export const FIND_UPDATE_EXCERPT_PATH = "meta/LokaceStavyPoznamky.json";
export const FIND_UPDATE_MANIFEST_PATH = "manifest.json";

/** `stavy` keys the desktop owns and always sends (empty = remove). The
 *  last two are retired states the desktop still keeps in its LSP. */
export const DESKTOP_OWNED_STATES = [
  "BEZFOTKY",
  "BEZGPS",
  "DAROVANY",
  "ZTRACENY",
  "LOKACE-NEEXISTUJE",
  "NEUTRZEN",
] as const;

const OWNED = new Set<string>(DESKTOP_OWNED_STATES);

/** DB state → its LSP key (DONATED → DAROVANY), to compare a filename's
 *  states with the excerpt in the excerpt's own vocabulary. */
const KEY_OF_STATE = new Map<FindState, string>(
  Object.entries(JSON_STATE_MAP).map(([key, state]) => [state, key]),
);

const sha1Field = z
  .string()
  .regex(/^[0-9a-f]{40}$/, "sha1 musí být 40 znaků lowercase hex");

const ManifestFindSchema = z.strictObject({
  original: z.string().min(1),
  crop: z.string().min(1, "ořez je povinný (V9)"),
  // R3: photos are always sent. `false` is reserved for a later
  // rename-only variant this version does not implement.
  imagesIncluded: z.literal(true, {
    error: "imagesIncluded musí být true (varianta bez fotek zatím není)",
  }),
  sha1: z.strictObject({ original: sha1Field, crop: sha1Field }),
});
export type FindUpdateManifestFind = z.infer<typeof ManifestFindSchema>;

export const FindUpdateManifestSchema = z.object({
  typ: z.literal(FIND_UPDATE_TYP),
  schema_version: z.literal(FIND_UPDATE_SCHEMA_VERSION, {
    error: `neznámá schema_version (web umí ${FIND_UPDATE_SCHEMA_VERSION})`,
  }),
  generatedAt: z.string().optional(),
  generator: z.string().optional(),
  finds: z
    .record(
      z.string().regex(/^[1-9]\d*$/, "klíč musí být číslo nálezu bez úvodních nul"),
      ManifestFindSchema,
    )
    .refine((o) => Object.keys(o).length > 0, "manifest neobsahuje žádný nález"),
});
export type FindUpdateManifest = z.infer<typeof FindUpdateManifestSchema>;

/** The excerpt: every section the desktop owns is required (they are the
 *  "full truth"); `stavy` keys are checked against DESKTOP_OWNED_STATES by
 *  `planFindUpdate` so a stray key gets a readable error, not a Zod one. */
export const FindUpdateExcerptSchema = z.strictObject({
  lokace: lokaceSchema,
  stavy: z.record(z.string(), rangesField),
  poznamky: poznamkySchema,
  anonymizace: z.strictObject({ ANONYMIZOVANE: rangesField }),
});
export type FindUpdateExcerpt = z.infer<typeof FindUpdateExcerptSchema>;

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function zodError(e: z.ZodError, root: string): string {
  const first = e.issues[0];
  if (!first) return `neplatný ${root}`;
  return `${first.path.join(".") || root}: ${first.message}`;
}

/** Parses the manifest. Filenames are NFC-normalised — names typed on
 *  macOS arrive decomposed and would never match the zip entries. */
export function parseFindUpdateManifest(json: string): ParseResult<FindUpdateManifest> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    return { ok: false, error: `nečitelný JSON (${(e as Error).message})` };
  }
  const parsed = FindUpdateManifestSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: zodError(parsed.error, "manifest") };
  const finds: Record<string, FindUpdateManifestFind> = {};
  for (const [id, f] of Object.entries(parsed.data.finds)) {
    finds[id] = {
      ...f,
      original: f.original.normalize("NFC"),
      crop: f.crop.normalize("NFC"),
    };
  }
  return { ok: true, value: { ...parsed.data, finds } };
}

/** Parses the LSP excerpt; note texts are NFC-normalised like the names. */
export function parseFindUpdateExcerpt(json: string): ParseResult<FindUpdateExcerpt> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    return { ok: false, error: `nečitelný JSON (${(e as Error).message})` };
  }
  const parsed = FindUpdateExcerptSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: zodError(parsed.error, "výřez LSP") };
  const poznamky: Record<string, string> = {};
  for (const [id, text] of Object.entries(parsed.data.poznamky)) {
    poznamky[id] = text.normalize("NFC");
  }
  return { ok: true, value: { ...parsed.data, poznamky } };
}

// ---------------------------------------------------------------- LSP merge

/** Rewrites one range list without the given ids plus `add`. Returns the
 *  ORIGINAL array when nothing changes, so untouched lists keep their exact
 *  formatting and the file diff stays limited to what the package changed. */
function replaceIn(
  specs: readonly string[] | undefined,
  remove: ReadonlySet<number>,
  add: readonly number[],
): string[] | undefined {
  const current = specs ? parseRanges(specs) : [];
  const kept = current.filter((id) => !remove.has(id));
  const next = [...kept, ...add];
  const before = new Set(current);
  const after = new Set(next);
  const same = before.size === after.size && [...after].every((id) => before.has(id));
  if (same) return specs ? [...specs] : specs;
  return compactToRanges(next);
}

function idsOf(specs: readonly string[] | undefined): number[] {
  return specs ? parseRanges(specs) : [];
}

/**
 * The LSP after the package: for every find in `ids`, the desktop-owned
 * parts are replaced by the excerpt (§4.3 / §5 of the contract) —
 *   - `lokace`, `poznamky`, `anonymizace.ANONYMIZOVANE`: the find is removed
 *     everywhere, then put back exactly as the excerpt says;
 *   - `stavy`: the same, but only for keys PRESENT in the excerpt; a key the
 *     excerpt doesn't carry (GIGANT, the web's own) is left untouched.
 * Finds not in `ids` are never touched. The result is re-validated against
 * the strict schema of the on-disk file.
 */
export function applyFindUpdateToLsp(
  lsp: LokaceStavyPoznamky,
  excerpt: FindUpdateExcerpt,
  ids: ReadonlySet<number>,
): LokaceStavyPoznamky {
  const lokace: Record<string, string[]> = {};
  const lokaceAdd = new Map<string, number[]>();
  for (const [key, specs] of Object.entries(excerpt.lokace)) {
    lokaceAdd.set(key, idsOf(specs).filter((id) => ids.has(id)));
  }
  for (const [key, specs] of Object.entries(lsp.lokace)) {
    lokace[key] = replaceIn(specs, ids, lokaceAdd.get(key) ?? []) ?? [];
    lokaceAdd.delete(key);
  }
  for (const [key, add] of lokaceAdd) {
    if (add.length > 0) lokace[key] = compactToRanges(add);
  }

  const stavy: Record<string, string[]> = { ...lsp.stavy } as Record<string, string[]>;
  for (const [key, specs] of Object.entries(excerpt.stavy)) {
    // Undefined only when the key is absent from the live file AND nothing
    // is being added — then it stays absent.
    const next = replaceIn(
      lsp.stavy[key as keyof typeof lsp.stavy],
      ids,
      idsOf(specs).filter((id) => ids.has(id)),
    );
    if (next !== undefined) stavy[key] = next;
  }

  const anon =
    replaceIn(
      lsp.anonymizace.ANONYMIZOVANE,
      ids,
      idsOf(excerpt.anonymizace.ANONYMIZOVANE).filter((id) => ids.has(id)),
    ) ?? [];

  const poznamky: Record<string, string> = {};
  for (const [key, text] of Object.entries(lsp.poznamky)) {
    if (!ids.has(Number(key))) poznamky[key] = text;
  }
  for (const [key, text] of Object.entries(excerpt.poznamky)) {
    if (ids.has(Number(key))) poznamky[key] = text;
  }

  return lokaceStavyPoznamkySchema.parse({
    anonymizace: { ANONYMIZOVANE: anon },
    lokace,
    poznamky,
    stavy,
  });
}

// ------------------------------------------------------------------ planning

/** What the site knows about one find in the package (gathered by the
 *  importer from the database and `data/`). */
export interface WebFind {
  /** A row in `finds` — i.e. the find has been through sync (V2). */
  existsInDb: boolean;
  /** `find_images.original_sha1` per image type, null when there is none. */
  sha1: { original: string | null; crop: string | null };
  /** Current files carrying this find's number. */
  files: { finds: string[]; crops: string[] };
}

export interface MapInfo {
  locationId: number;
  /** The location has an anonymised map — every find on it stays
   *  anonymous no matter what its name says (V7b). */
  anonymized: boolean;
}

export interface PlanInput {
  manifest: FindUpdateManifest;
  excerpt: FindUpdateExcerpt;
  /** Every file path in the zip (NFC), with the SHA-1 of its bytes for
   *  entries under `finds/` and `crops/`. */
  zipEntries: ReadonlyArray<{ path: string; sha1: string | null }>;
  /** The live `data/meta/LokaceStavyPoznamky.json`. */
  lsp: LokaceStavyPoznamky;
  web: ReadonlyMap<number, WebFind>;
  /** Map number (filename field 2) → location, for the maps on the site. */
  maps: ReadonlyMap<number, MapInfo>;
  /** Finds with a web note override (cs or en) — dropped when the note
   *  changes (R8). */
  noteOverrides: ReadonlySet<number>;
}

export interface FindSide {
  /** LSP state keys the find is in. */
  states: string[];
  note: string | null;
  /** In `anonymizace.ANONYMIZOVANE`. */
  anonymizedInLsp: boolean;
  /** ANO in the filename. */
  anonymizedInName: boolean | null;
  /** Map number from the filename (= the location the find shows under). */
  mapNumber: number | null;
  original: string | null;
  crop: string | null;
}

export interface FindUpdateItem {
  findId: number;
  errors: string[];
  warnings: string[];
  before: FindSide;
  after: FindSide;
  /** "same" = identical bytes, the file is only renamed and nothing is
   *  re-encoded; "changed" = new photo. */
  images: { original: "same" | "changed"; crop: "same" | "changed" };
  /** R8: the web's note override for this find. */
  noteOverride: "none" | "kept" | "removed";
  /** Anything at all differs between before and after. */
  changed: boolean;
}

export interface FindUpdatePlan {
  ok: boolean;
  /** Package-level errors (not tied to one find). */
  errors: string[];
  warnings: string[];
  finds: FindUpdateItem[];
  generatedAt: string | null;
  generator: string | null;
}

function statesOf(lsp: Pick<LokaceStavyPoznamky, "stavy">, id: number): string[] {
  const out: string[] = [];
  for (const [key, specs] of Object.entries(lsp.stavy)) {
    if (specs && parseRanges(specs).includes(id)) out.push(key);
  }
  return out.sort();
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/** Stem without the extension, for "original and crop carry the same
 *  composed name" (§3). */
function stem(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

const JPEG_RE = /\.jpe?g$/i;

/**
 * Validates the package against the contract (V1–V10) and works out, per
 * find, what changes. Never throws on bad input — every problem becomes an
 * error line, and a single error anywhere means nothing is applied.
 */
export function planFindUpdate(input: PlanInput): FindUpdatePlan {
  const { manifest, excerpt, lsp } = input;
  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Set(Object.keys(manifest.finds).map(Number));

  // ---- package-level checks
  const entryByPath = new Map(input.zipEntries.map((e) => [e.path, e]));
  const expected = new Set<string>([FIND_UPDATE_MANIFEST_PATH, FIND_UPDATE_EXCERPT_PATH]);
  for (const f of Object.values(manifest.finds)) {
    expected.add(`finds/${f.original}`);
    expected.add(`crops/${f.crop}`);
  }
  // V4: exactly the manifest's files, nothing else.
  for (const e of input.zipEntries) {
    if (!expected.has(e.path)) {
      errors.push(`V4: soubor ${e.path} v manifestu není — balíček smí obsahovat jen soubory z manifestu.`);
    }
  }
  if (!entryByPath.has(FIND_UPDATE_EXCERPT_PATH)) {
    errors.push(`Chybí ${FIND_UPDATE_EXCERPT_PATH}.`);
  }

  // V10: stavy keys.
  for (const key of Object.keys(excerpt.stavy)) {
    if (key === "GIGANT") {
      errors.push("V10: výřez obsahuje stavy.GIGANT — ten patří webu, desktop ho neposílá.");
    } else if (!OWNED.has(key)) {
      errors.push(`V10: neznámý klíč stavy.${key}.`);
    }
  }
  const missingOwned = DESKTOP_OWNED_STATES.filter((k) => !(k in excerpt.stavy));
  if (missingOwned.length > 0) {
    warnings.push(
      `Výřez neobsahuje klíče stavy ${missingOwned.join(", ")} — web je u těchto nálezů ponechá beze změny.`,
    );
  }

  // V5: the excerpt speaks only about the manifest's finds.
  const excerptIds = new Set<number>();
  for (const specs of Object.values(excerpt.lokace)) idsOf(specs).forEach((id) => excerptIds.add(id));
  for (const specs of Object.values(excerpt.stavy)) idsOf(specs).forEach((id) => excerptIds.add(id));
  idsOf(excerpt.anonymizace.ANONYMIZOVANE).forEach((id) => excerptIds.add(id));
  Object.keys(excerpt.poznamky).forEach((id) => excerptIds.add(Number(id)));
  const stray = [...excerptIds].filter((id) => !ids.has(id)).sort((a, b) => a - b);
  if (stray.length > 0) {
    errors.push(`V5: výřez LSP obsahuje nálezy, které v manifestu nejsou: ${compactToRanges(stray).join(", ")}.`);
  }

  // Where each find sits in the excerpt's lokace.
  const lokaceKeysOf = new Map<number, string[]>();
  for (const [key, specs] of Object.entries(excerpt.lokace)) {
    for (const id of idsOf(specs)) {
      const list = lokaceKeysOf.get(id) ?? [];
      list.push(key);
      lokaceKeysOf.set(id, list);
    }
  }
  const excerptAnon = new Set(idsOf(excerpt.anonymizace.ANONYMIZOVANE));
  const lspAnon = new Set(idsOf(lsp.anonymizace.ANONYMIZOVANE));

  // The merged LSP, only when the inputs are sound enough to compute it.
  let nextLsp: LokaceStavyPoznamky | null = null;
  try {
    nextLsp = applyFindUpdateToLsp(lsp, excerpt, ids);
  } catch (e) {
    errors.push(`Sloučení LSP selhalo: ${(e as Error).message}`);
  }
  const nextAnon = new Set(nextLsp ? idsOf(nextLsp.anonymizace.ANONYMIZOVANE) : []);

  const finds: FindUpdateItem[] = [];
  for (const [key, entry] of Object.entries(manifest.finds)) {
    const id = Number(key);
    const fErr: string[] = [];
    const fWarn: string[] = [];
    const web = input.web.get(id);

    // V2
    if (!web?.existsInDb) {
      fErr.push("V2: nález na webu není (oprava je jen pro publikované; nové patří do běžného balíčku).");
    }

    // V3 (+ the same composed name for original and crop, §3)
    const orig = parseFindFilename(entry.original);
    const crop = parseFindFilename(entry.crop);
    for (const [label, name, p] of [
      ["originál", entry.original, orig],
      ["ořez", entry.crop, crop],
    ] as const) {
      if (!p.ok) fErr.push(`V3: ${label} „${name}" nejde rozparsovat: ${p.error}`);
      else if (p.value.findId !== id) fErr.push(`V3: ${label} „${name}" nese číslo ${p.value.findId}, ne ${id}.`);
      if (!JPEG_RE.test(name)) fErr.push(`V3: ${label} „${name}" není JPG.`);
    }
    if (stem(entry.original) !== stem(entry.crop)) {
      fErr.push("V3: originál a ořez musí nést stejný název (liší se).");
    }

    // V4 + V8: the files are in the zip and match their checksums.
    for (const [label, path, want] of [
      ["originál", `finds/${entry.original}`, entry.sha1.original],
      ["ořez", `crops/${entry.crop}`, entry.sha1.crop],
    ] as const) {
      const e = entryByPath.get(path);
      if (!e) fErr.push(`V4: ${label} ${path} v ZIPu chybí.`);
      else if (e.sha1 !== want) fErr.push(`V8: ${label} ${path} — sha1 nesedí s manifestem.`);
    }

    const name = orig.ok ? orig.value : null;
    // V6: exactly one lokace key, equal to the filename's map number, and
    // that map must exist here (otherwise sync would silently keep the old
    // location).
    const keys = lokaceKeysOf.get(id) ?? [];
    if (keys.length !== 1) {
      fErr.push(`V6: nález má být ve výřezu v lokace právě jednou (je ${keys.length}×).`);
    } else if (name && Number(keys[0]) !== name.mapNumber) {
      fErr.push(`V6: lokace ve výřezu (${keys[0]}) nesedí s číslem mapy v názvu (${String(name.mapNumber).padStart(5, "0")}).`);
    }
    if (keys.length === 1 && !/^[1-9]\d*$/.test(keys[0]!)) {
      fErr.push(`V6: klíč lokace „${keys[0]}" musí být číslo bez úvodních nul.`);
    }
    const map = name ? input.maps.get(name.mapNumber) : undefined;
    if (name && !map) {
      fErr.push(`V6: mapa ${String(name.mapNumber).padStart(5, "0")} na webu neexistuje.`);
    }

    // V7 / V7b
    if (name) {
      if (name.isAnonymized !== excerptAnon.has(id)) {
        fErr.push(
          name.isAnonymized
            ? "V7: název má ANO, ale nález není v anonymizace.ANONYMIZOVANE."
            : "V7: nález je v anonymizace.ANONYMIZOVANE, ale název má NE.",
        );
      }
      if (!name.isAnonymized && map?.anonymized) {
        fErr.push("V7b: název má NE, ale lokalita má anonymizovanou mapu — nález by zůstal anonymní.");
      }
    }

    // Non-blocking: the filename is the readable imprint of the LSP. Both
    // sides are compared as LSP keys, and only over the desktop-owned
    // states that have a filename token (not GIGANT, not the retired ones).
    if (name) {
      const nameStates = name.states
        .map((s) => KEY_OF_STATE.get(s))
        .filter((k): k is string => k !== undefined && OWNED.has(k))
        .sort();
      const lspStates = Object.entries(excerpt.stavy)
        .filter(([k, specs]) => OWNED.has(k) && KEY_OF_STATE.has(JSON_STATE_MAP[k]!) && idsOf(specs).includes(id))
        .map(([k]) => k)
        .sort();
      if (!sameSet(nameStates, lspStates)) {
        fWarn.push(`Stav v názvu (${nameStates.join(", ") || "NORMÁLNÍ"}) nesedí se stavy ve výřezu (${lspStates.join(", ") || "žádný"}).`);
      }
      const hasNote = Object.prototype.hasOwnProperty.call(excerpt.poznamky, key);
      if (name.hasNote !== hasNote) {
        fWarn.push(hasNote ? "Výřez má poznámku, název říká BezPoznámky." : "Název nese poznámku, výřez žádnou nemá.");
      }
    }

    const currentOriginal = web?.files.finds[0] ?? null;
    const currentName = currentOriginal ? parseFindFilename(currentOriginal) : null;
    const beforeNote = lsp.poznamky[key] ?? null;
    const afterNote = excerpt.poznamky[key] ?? null;
    const before: FindSide = {
      states: statesOf(lsp, id),
      note: beforeNote,
      anonymizedInLsp: lspAnon.has(id),
      anonymizedInName: currentName?.ok ? currentName.value.isAnonymized : null,
      mapNumber: currentName?.ok ? currentName.value.mapNumber : null,
      original: currentOriginal,
      crop: web?.files.crops[0] ?? null,
    };
    const after: FindSide = {
      states: nextLsp ? statesOf(nextLsp, id) : [],
      note: afterNote,
      anonymizedInLsp: nextAnon.has(id),
      anonymizedInName: name ? name.isAnonymized : null,
      mapNumber: name ? name.mapNumber : null,
      original: entry.original,
      crop: entry.crop,
    };

    if (web && (web.files.finds.length > 1 || web.files.crops.length > 1)) {
      fWarn.push(
        `Na webu leží víc souborů tohoto čísla (${web.files.finds.length} originálů, ${web.files.crops.length} ořezů) — oprava je nahradí jedním.`,
      );
    }

    const images = {
      original: web?.sha1.original === entry.sha1.original ? ("same" as const) : ("changed" as const),
      crop: web?.sha1.crop === entry.sha1.crop ? ("same" as const) : ("changed" as const),
    };
    const noteOverride: FindUpdateItem["noteOverride"] = !input.noteOverrides.has(id)
      ? "none"
      : beforeNote !== afterNote
        ? "removed"
        : "kept";

    const changed =
      !sameSet(before.states, after.states) ||
      before.note !== after.note ||
      before.anonymizedInLsp !== after.anonymizedInLsp ||
      before.anonymizedInName !== after.anonymizedInName ||
      before.mapNumber !== after.mapNumber ||
      before.original !== after.original ||
      before.crop !== after.crop ||
      images.original === "changed" ||
      images.crop === "changed";

    finds.push({
      findId: id,
      errors: fErr,
      warnings: fWarn,
      before,
      after,
      images,
      noteOverride,
      changed,
    });
  }
  finds.sort((a, b) => a.findId - b.findId);

  const ok = errors.length === 0 && finds.every((f) => f.errors.length === 0);
  return {
    ok,
    errors,
    warnings,
    finds,
    generatedAt: manifest.generatedAt ?? null,
    generator: manifest.generator ?? null,
  };
}
