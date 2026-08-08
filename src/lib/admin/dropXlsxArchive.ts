import { promises as fs } from "node:fs";
import path from "node:path";
import { atomicWrite, ensureDir } from "@/lib/admin/atomic";
import { ADMIN_ROOTS } from "@/lib/admin/paths";

/**
 * Every spreadsheet the crew uploads, kept.
 *
 * The sheet is how a wave gets filled in: it goes onto a shared drive,
 * several people type into it, and it comes back. That makes an upload
 * the moment where somebody else's afternoon of work either lands or
 * quietly overwrites somebody else's — so the file is archived exactly as
 * received, before a single row is applied.
 *
 * Kept under `data/.admin/backups/drop-xlsx/<campaign>/`, capped at
 * MAX_ARCHIVED newest per campaign. Same rotation idea as the LSP
 * backups, and deliberately NOT in `.trash`: this is an audit trail of
 * inputs, not a bin of deleted things.
 */

export const MAX_ARCHIVED = 20;
const SUBDIR = "drop-xlsx";

function campaignDir(campaignId: number): string {
  return path.join(ADMIN_ROOTS.backups, SUBDIR, String(campaignId));
}

export interface ArchivedXlsx {
  /** Storage name, also the sort key: `<iso>__<slug>.xlsx`. */
  name: string;
  uploadedAt: string;
  /** The filename as it arrived, for recognising whose copy this was. */
  originalName: string;
  bytes: number;
  /** What the import did with it, recorded alongside the file. */
  matched: number;
  changed: number;
  blocked: boolean;
}

interface Meta {
  uploadedAt: string;
  originalName: string;
  matched: number;
  changed: number;
  blocked: boolean;
}

/** Filename-safe, lexicographically sortable — ISO order is chronological. */
function stamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

function slug(name: string): string {
  return (
    name
      .replace(/\.xlsx$/i, "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40)
      .toLowerCase() || "tabulka"
  );
}

/** Rejects anything that isn't one of our own archive names. */
export function safeArchiveName(name: string): string {
  if (!/^[0-9A-Za-z_\-]+\.xlsx$/.test(name) || name.includes("..")) {
    throw new Error(`Neplatný název archivu: ${name}`);
  }
  return name;
}

/**
 * Stores the uploaded workbook and prunes the oldest beyond the cap.
 *
 * Never throws into the caller: losing the archive copy must not fail an
 * import that otherwise succeeded — the operator's edit is worth more
 * than our bookkeeping.
 */
export async function archiveDropXlsx(
  campaignId: number,
  bytes: Buffer,
  meta: Omit<Meta, "uploadedAt">,
  now: Date,
): Promise<void> {
  try {
    const dir = campaignDir(campaignId);
    await ensureDir(dir);
    const name = `${stamp(now)}__${slug(meta.originalName)}.xlsx`;
    await atomicWrite(path.join(dir, name), bytes);
    const sidecar: Meta = { ...meta, uploadedAt: now.toISOString() };
    await atomicWrite(
      path.join(dir, `${name}.json`),
      Buffer.from(JSON.stringify(sidecar, null, 2)),
    );
    await prune(dir);
  } catch {
    /* archiving is best-effort — see the note above */
  }
}

async function prune(dir: string): Promise<void> {
  const entries = (await fs.readdir(dir))
    .filter((n) => n.endsWith(".xlsx"))
    .sort()
    .reverse();
  for (const stale of entries.slice(MAX_ARCHIVED)) {
    await fs.rm(path.join(dir, stale), { force: true });
    await fs.rm(path.join(dir, `${stale}.json`), { force: true });
  }
}

/** Newest first. Missing directory = no uploads yet, not an error. */
export async function listDropXlsx(
  campaignId: number,
): Promise<ArchivedXlsx[]> {
  const dir = campaignDir(campaignId);
  let names: string[];
  try {
    names = (await fs.readdir(dir)).filter((n) => n.endsWith(".xlsx"));
  } catch {
    return [];
  }
  const out: ArchivedXlsx[] = [];
  for (const name of names.sort().reverse()) {
    const full = path.join(dir, name);
    const stat = await fs.stat(full).catch(() => null);
    if (!stat) continue;
    let meta: Partial<Meta> = {};
    try {
      meta = JSON.parse(await fs.readFile(`${full}.json`, "utf8")) as Meta;
    } catch {
      /* an archive without its sidecar is still worth listing */
    }
    out.push({
      name,
      uploadedAt: meta.uploadedAt ?? stat.mtime.toISOString(),
      originalName: meta.originalName ?? name,
      bytes: stat.size,
      matched: meta.matched ?? 0,
      changed: meta.changed ?? 0,
      blocked: meta.blocked ?? false,
    });
  }
  return out;
}

/** Reads one archived workbook back, for re-download. */
export async function readDropXlsx(
  campaignId: number,
  name: string,
): Promise<Buffer> {
  return fs.readFile(path.join(campaignDir(campaignId), safeArchiveName(name)));
}
