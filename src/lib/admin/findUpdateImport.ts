import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";
import { readFindNoteOverrides } from "@/lib/findNoteOverrides";
import {
  FIND_UPDATE_EXCERPT_PATH,
  FIND_UPDATE_MANIFEST_PATH,
  FIND_UPDATE_TYP,
  parseFindUpdateExcerpt,
  parseFindUpdateManifest,
  planFindUpdate,
  type FindUpdatePlan,
  type MapInfo,
  type WebFind,
} from "@/lib/findUpdatePackage";
import { readPackageTyp } from "@/lib/locationPhotoPackage";
import { parseFindFilename } from "@/lib/parseFilename";
import { findIdOf, readZipEntry } from "./importZip";
import {
  LOKACE_STAVY_POZNAMKY_FILENAME,
  lokaceStavyPoznamkySchema,
  type LokaceStavyPoznamky,
} from "./jsonSchema";
import { iterateZipUtf8 } from "./mapPackageImport";
import { ADMIN_ROOTS } from "./paths";

/**
 * Import of an "oprava-nalezu" package — corrections of finds already on
 * the site, from the desktop app. The rules live in `findUpdatePackage.ts`
 * (pure); this module only gathers what they need: the package's manifest,
 * LSP excerpt and photo checksums, and what the site knows about the same
 * finds (database rows, files in `data/`, the live LSP, note overrides).
 *
 * Phase F1: analysis only — nothing here writes.
 */

/** The manifest's text, or null when the zip isn't an update package. */
async function readUpdateManifestText(zipPath: string): Promise<string | null> {
  let buf: Buffer | null = null;
  await iterateZipUtf8(zipPath, async (zp, zip, raw) => {
    if (zp === FIND_UPDATE_MANIFEST_PATH) buf = await readZipEntry(zip, raw);
  });
  if (buf === null) return null;
  const text = (buf as Buffer).toString("utf8");
  return readPackageTyp(text) === FIND_UPDATE_TYP ? text : null;
}

/** True when the zip carries `"typ": "oprava-nalezu"`. Checked FIRST: a
 *  manifest the map importer doesn't recognise would otherwise be taken for
 *  a map package, and a commit would fall through to the ordinary one. */
export async function isFindUpdatePackageZip(zipPath: string): Promise<boolean> {
  return (await readUpdateManifestText(zipPath)) !== null;
}

async function readLiveLsp(): Promise<LokaceStavyPoznamky | { error: string }> {
  const file = path.join(ADMIN_ROOTS.meta, LOKACE_STAVY_POZNAMKY_FILENAME);
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (e) {
    return { error: `Hlavní ${LOKACE_STAVY_POZNAMKY_FILENAME} na webu nejde přečíst: ${(e as Error).message}` };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { error: `Hlavní ${LOKACE_STAVY_POZNAMKY_FILENAME} není platný JSON: ${(e as Error).message}` };
  }
  const parsed = lokaceStavyPoznamkySchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      error: `Hlavní ${LOKACE_STAVY_POZNAMKY_FILENAME} neodpovídá schématu (${first ? `${first.path.join(".")}: ${first.message}` : "?"}) — oprav ho v editoru, než pustíš opravu.`,
    };
  }
  return parsed.data;
}

/** Files in `dir` carrying one of `ids`, grouped by number (NFC names). */
async function filesById(dir: string, ids: ReadonlySet<number>): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  let names: string[] = [];
  try {
    names = await fs.readdir(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    return out;
  }
  for (const raw of names) {
    const name = raw.normalize("NFC");
    if (name.startsWith(".")) continue;
    const id = findIdOf(name);
    if (id === null || !ids.has(id)) continue;
    const list = out.get(id) ?? [];
    list.push(name);
    out.set(id, list);
  }
  for (const list of out.values()) list.sort();
  return out;
}

/**
 * Read-only analysis: validates the package against the contract and says,
 * per find, what would change. Returns `{ error }` only when the package
 * can't even be read; every rule violation is in the plan instead.
 */
export async function analyzeFindUpdateZip(
  zipPath: string,
): Promise<FindUpdatePlan | { error: string }> {
  const manifestText = await readUpdateManifestText(zipPath);
  if (manifestText === null) return { error: "ZIP není opravný balíček nálezů." };
  const manifest = parseFindUpdateManifest(manifestText);
  if (!manifest.ok) return { error: `Neplatný manifest.json: ${manifest.error}` };

  // One pass over the zip: the excerpt's text and the SHA-1 of every photo.
  let excerptText: string | null = null;
  const zipEntries: { path: string; sha1: string | null }[] = [];
  await iterateZipUtf8(zipPath, async (zp, zip, raw) => {
    if (zp === FIND_UPDATE_EXCERPT_PATH) {
      excerptText = (await readZipEntry(zip, raw)).toString("utf8");
      zipEntries.push({ path: zp, sha1: null });
    } else if (zp.startsWith("finds/") || zp.startsWith("crops/")) {
      const bytes = await readZipEntry(zip, raw);
      zipEntries.push({ path: zp, sha1: createHash("sha1").update(bytes).digest("hex") });
    } else {
      zipEntries.push({ path: zp, sha1: null });
    }
  });
  if (excerptText === null) return { error: `V balíčku chybí ${FIND_UPDATE_EXCERPT_PATH}.` };
  const excerpt = parseFindUpdateExcerpt(excerptText);
  if (!excerpt.ok) return { error: `Neplatný ${FIND_UPDATE_EXCERPT_PATH}: ${excerpt.error}` };

  const lsp = await readLiveLsp();
  if ("error" in lsp) return lsp;

  const ids = new Set(Object.keys(manifest.value.finds).map(Number));
  const idList = [...ids];

  const [rows, images, originals, crops, overrides] = await Promise.all([
    prisma.find.findMany({ where: { id: { in: idList } }, select: { id: true } }),
    prisma.findImage.findMany({
      where: { findId: { in: idList } },
      select: { findId: true, imageType: true, originalSha1: true },
    }),
    filesById(ADMIN_ROOTS.findOriginals, ids),
    filesById(ADMIN_ROOTS.findCrops, ids),
    readFindNoteOverrides(),
  ]);

  const inDb = new Set(rows.map((r) => r.id));
  const web = new Map<number, WebFind>();
  for (const id of ids) {
    const sha = (type: "ORIGINAL" | "CROP") =>
      images.find((i) => i.findId === id && i.imageType === type)?.originalSha1 ?? null;
    web.set(id, {
      existsInDb: inDb.has(id),
      sha1: { original: sha("ORIGINAL"), crop: sha("CROP") },
      files: { finds: originals.get(id) ?? [], crops: crops.get(id) ?? [] },
    });
  }

  // The maps the new names point at, and whether their location is
  // anonymised (any of its maps is — the rule sync applies).
  const mapNumbers = new Set<number>();
  for (const f of Object.values(manifest.value.finds)) {
    const p = parseFindFilename(f.original);
    if (p.ok) mapNumbers.add(p.value.mapNumber);
  }
  const mapRows = await prisma.locationMap.findMany({
    where: { id: { in: [...mapNumbers] } },
    select: { id: true, locationId: true },
  });
  const anonLocations = new Set(
    (
      await prisma.locationMap.findMany({
        where: { locationId: { in: mapRows.map((m) => m.locationId) }, isAnonymized: true },
        select: { locationId: true },
      })
    ).map((m) => m.locationId),
  );
  const maps = new Map<number, MapInfo>(
    mapRows.map((m) => [m.id, { locationId: m.locationId, anonymized: anonLocations.has(m.locationId) }]),
  );

  const noteOverrides = new Set<number>();
  for (const [id, o] of overrides) if (o.cs || o.en) noteOverrides.add(id);

  return planFindUpdate({
    manifest: manifest.value,
    excerpt: excerpt.value,
    zipEntries,
    lsp,
    web,
    maps,
    noteOverrides,
  });
}
