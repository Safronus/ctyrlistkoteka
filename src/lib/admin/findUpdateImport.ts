import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";
import {
  readFindNoteOverrides,
  removeFindNoteOverrides,
  restoreFindNoteOverridesRaw,
} from "@/lib/findNoteOverrides";
import {
  applyFindUpdateToLsp,
  FIND_UPDATE_EXCERPT_PATH,
  FIND_UPDATE_MANIFEST_PATH,
  FIND_UPDATE_TYP,
  parseFindUpdateExcerpt,
  parseFindUpdateManifest,
  planFindUpdate,
  type FindUpdateExcerpt,
  type FindUpdateManifest,
  type FindUpdatePlan,
  type MapInfo,
  type WebFind,
} from "@/lib/findUpdatePackage";
import { readPackageTyp } from "@/lib/locationPhotoPackage";
import { parseFindFilename } from "@/lib/parseFilename";
import { findIdOf, readZipEntry } from "./importZip";
import {
  LOKACE_STAVY_POZNAMKY_FILENAME,
  lokaceStavyPoznamkyMergeInputSchema,
  lokaceStavyPoznamkySchema,
  type LokaceStavyPoznamky,
} from "./jsonSchema";
import { atomicWrite, ensureDir } from "./atomic";
import { formatJsonCompactArrays } from "./jsonFormat";
import { createBackup } from "./lspBackups";
import { iterateZipUtf8 } from "./mapPackageImport";
import { ADMIN_ROOTS, safeJoin } from "./paths";
import { getStatus } from "./syncRunner";
import { prepareTrashDir } from "./trash";

/**
 * Import of an "oprava-nalezu" package — corrections of finds already on
 * the site, from the desktop app. The rules live in `findUpdatePackage.ts`
 * (pure); this module only gathers what they need: the package's manifest,
 * LSP excerpt and photo checksums, and what the site knows about the same
 * finds (database rows, files in `data/`, the live LSP, note overrides).
 *
 * `analyzeFindUpdateZip` only reads. `commitFindUpdateZip` writes, and
 * re-runs the very same checks first — a plan that was fine an hour ago
 * may not be now.
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
  // Lenient first, like the LSP merge: a `metadata` block rsynced in from
  // the desktop exporter is stripped, and a missing section is empty. The
  // result must still pass the strict on-disk schema.
  const lenient = lokaceStavyPoznamkyMergeInputSchema.safeParse(json);
  const parsed = lokaceStavyPoznamkySchema.safeParse(
    lenient.success
      ? {
          anonymizace: { ANONYMIZOVANE: lenient.data.anonymizace?.ANONYMIZOVANE ?? [] },
          lokace: lenient.data.lokace ?? {},
          poznamky: lenient.data.poznamky ?? {},
          stavy: lenient.data.stavy ?? {},
        }
      : json,
  );
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

interface Prepared {
  manifest: FindUpdateManifest;
  excerpt: FindUpdateExcerpt;
  lsp: LokaceStavyPoznamky;
  plan: FindUpdatePlan;
  /** Bytes of every finds/ and crops/ entry — only when asked for. */
  bytes: Map<string, Buffer>;
}

/** Everything the checks need, read once — shared by analyze and commit so
 *  the commit applies exactly what it validated. */
async function prepare(
  zipPath: string,
  keepBytes: boolean,
): Promise<Prepared | { error: string }> {
  const manifestText = await readUpdateManifestText(zipPath);
  if (manifestText === null) return { error: "ZIP není opravný balíček nálezů." };
  const manifest = parseFindUpdateManifest(manifestText);
  if (!manifest.ok) return { error: `Neplatný manifest.json: ${manifest.error}` };

  // One pass over the zip: the excerpt's text and the SHA-1 of every photo.
  let excerptText: string | null = null;
  const zipEntries: { path: string; sha1: string | null }[] = [];
  const bytes = new Map<string, Buffer>();
  await iterateZipUtf8(zipPath, async (zp, zip, raw) => {
    if (zp === FIND_UPDATE_EXCERPT_PATH) {
      excerptText = (await readZipEntry(zip, raw)).toString("utf8");
      zipEntries.push({ path: zp, sha1: null });
    } else if (zp.startsWith("finds/") || zp.startsWith("crops/")) {
      const buf = await readZipEntry(zip, raw);
      zipEntries.push({ path: zp, sha1: sha1Of(buf) });
      if (keepBytes) bytes.set(zp, buf);
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

  const plan = planFindUpdate({
    manifest: manifest.value,
    excerpt: excerpt.value,
    zipEntries,
    lsp,
    web,
    maps,
    noteOverrides,
  });
  return { manifest: manifest.value, excerpt: excerpt.value, lsp, plan, bytes };
}

function sha1Of(buf: Buffer): string {
  return createHash("sha1").update(buf).digest("hex");
}

/**
 * Read-only analysis: validates the package against the contract and says,
 * per find, what would change. Returns `{ error }` only when the package
 * can't even be read; every rule violation is in the plan instead.
 */
export async function analyzeFindUpdateZip(
  zipPath: string,
): Promise<FindUpdatePlan | { error: string }> {
  const r = await prepare(zipPath, false);
  return "error" in r ? r : r.plan;
}

export interface FindUpdateCommitSummary {
  finds: number;
  /** Files whose bytes were already on the site — renamed, not rewritten. */
  renamed: number;
  /** Files with new bytes. */
  written: number;
  /** Already in place under the new name with the same bytes. */
  unchanged: number;
  /** Old files of the corrected finds moved to the trash. */
  trashed: number;
  noteOverridesRemoved: number;
  /** `data/.trash/<ts>` bucket holding what was replaced, for the operator. */
  trashBucket: string | null;
}

/** Outcome of the sync the commit route starts right after a correction:
 *  started, or refused (the files are committed either way). */
export type UpdateSyncStart =
  | { started: true; runId: string }
  | { started: false; reason: string };

/** One reversible step on disk. */
type Op =
  | { kind: "trash"; from: string; copy: string }
  | { kind: "rename"; from: string; to: string }
  | { kind: "write"; to: string };

async function undo(ops: Op[]): Promise<string[]> {
  const failures: string[] = [];
  for (const op of [...ops].reverse()) {
    try {
      if (op.kind === "write") await fs.rm(op.to, { force: true });
      else if (op.kind === "rename") await fs.rename(op.to, op.from);
      else await fs.copyFile(op.copy, op.from);
    } catch (e) {
      failures.push(`${op.kind} ${path.basename("to" in op ? op.to : op.from)}: ${(e as Error).message}`);
    }
  }
  return failures;
}

/**
 * Writes the package: for every corrected find, exactly one original and one
 * crop under the new names (identical bytes are renamed, not rewritten, so
 * sync reuses the existing WebP), the old files to the trash, the web's note
 * override dropped where the note changed (R8), and finally the LSP.
 *
 * All or nothing: the checks run again first and any error stops before a
 * single write; a failure part-way puts every file back from the trash and
 * restores the overrides. The LSP is written LAST (after a rotating backup
 * and a trash snapshot), so until it lands nothing is half-applied.
 *
 * Writes no database rows — that's sync's job (F3 starts it).
 */
export async function commitFindUpdateZip(
  zipPath: string,
): Promise<{ summary: FindUpdateCommitSummary; plan: FindUpdatePlan } | { error: string; plan?: FindUpdatePlan }> {
  // A sync reading data/ half-way through this would see files and LSP out
  // of step. Only an admin-started sync is visible here; a CLI `pnpm sync`
  // on the VPS isn't, which the UI says.
  const status = await getStatus();
  if (status?.state === "running") {
    return { error: "Právě běží sync — počkej na jeho dokončení a potvrď opravu znovu." };
  }

  const prep = await prepare(zipPath, true);
  if ("error" in prep) return prep;
  const { manifest, excerpt, lsp, plan, bytes } = prep;
  if (!plan.ok) {
    return { error: "Balíček neprošel kontrolami — nic se nezapsalo.", plan };
  }

  const ids = new Set(Object.keys(manifest.finds).map(Number));
  const nextLsp = applyFindUpdateToLsp(lsp, excerpt, ids);
  const lspText = `${formatJsonCompactArrays(nextLsp)}\n`;
  const lspPath = path.join(ADMIN_ROOTS.meta, LOKACE_STAVY_POZNAMKY_FILENAME);

  const summary: FindUpdateCommitSummary = {
    finds: ids.size,
    renamed: 0,
    written: 0,
    unchanged: 0,
    trashed: 0,
    noteOverridesRemoved: 0,
    trashBucket: null,
  };
  const ops: Op[] = [];
  const trashDirs = new Map<string, string>();
  const trashDir = async (scope: string) => {
    let dir = trashDirs.get(scope);
    if (!dir) {
      dir = await prepareTrashDir(scope);
      trashDirs.set(scope, dir);
      summary.trashBucket ??= path.relative(ADMIN_ROOTS.trash, path.dirname(dir));
    }
    return dir;
  };
  const moveToTrash = async (abs: string, scope: string) => {
    const copy = path.join(await trashDir(scope), path.basename(abs));
    await fs.copyFile(abs, copy);
    await fs.rm(abs);
    ops.push({ kind: "trash", from: abs, copy });
    summary.trashed += 1;
  };

  let overridesRaw: string | null | undefined;
  try {
    for (const [key, entry] of Object.entries(manifest.finds)) {
      const id = Number(key);
      for (const kind of ["finds", "crops"] as const) {
        const root = kind === "finds" ? "findOriginals" : "findCrops";
        const name = kind === "finds" ? entry.original : entry.crop;
        const newBytes = bytes.get(`${kind}/${name}`);
        if (!newBytes) throw new Error(`${kind}/${name} chybí v ZIPu`);
        const newSha = sha1Of(newBytes);
        const target = safeJoin(root, name);

        // Fresh listing — the plan's is from the analysis.
        const current = (await filesById(ADMIN_ROOTS[root], new Set([id]))).get(id) ?? [];
        const withSha = await Promise.all(
          current.map(async (n) => ({ name: n, abs: safeJoin(root, n), sha: sha1Of(await fs.readFile(safeJoin(root, n))) })),
        );
        // Prefer the file already under the target name, then any file with
        // the same bytes — that one is renamed instead of rewritten.
        const keeper =
          withSha.find((f) => f.name === name && f.sha === newSha) ??
          withSha.find((f) => f.sha === newSha) ??
          null;
        for (const f of withSha) {
          if (f !== keeper) await moveToTrash(f.abs, kind);
        }
        if (keeper && keeper.name === name) {
          summary.unchanged += 1;
        } else if (keeper) {
          await fs.rename(keeper.abs, target);
          ops.push({ kind: "rename", from: keeper.abs, to: target });
          summary.renamed += 1;
        } else {
          await ensureDir(path.dirname(target));
          await atomicWrite(target, newBytes);
          ops.push({ kind: "write", to: target });
          summary.written += 1;
        }
      }
    }

    // R8: the note changed → the web's override (cs + en) would shadow it.
    const dropOverrides = plan.finds.filter((f) => f.noteOverride === "removed").map((f) => f.findId);
    if (dropOverrides.length > 0) {
      overridesRaw = await removeFindNoteOverrides(dropOverrides);
      summary.noteOverridesRemoved = dropOverrides.length;
    }

    // LSP last: rotating backup + trash snapshot, then the atomic write.
    await createBackup();
    await fs.copyFile(lspPath, path.join(await trashDir("meta"), LOKACE_STAVY_POZNAMKY_FILENAME));
    await atomicWrite(lspPath, lspText);
  } catch (err) {
    const failures = await undo(ops);
    if (overridesRaw !== undefined) {
      try {
        await restoreFindNoteOverridesRaw(overridesRaw);
      } catch (e) {
        failures.push(`přepisy poznámek: ${(e as Error).message}`);
      }
    }
    return {
      error:
        `Zápis opravy selhal (${(err as Error).message}) — ` +
        (failures.length === 0
          ? "vše jsem vrátil do původního stavu, nic se nezměnilo."
          : `POZOR, návrat se nepovedl úplně: ${failures.join("; ")}. Původní soubory jsou v koši ${summary.trashBucket ?? "?"}.`),
      plan,
    };
  }

  return { summary, plan };
}
