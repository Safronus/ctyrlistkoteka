import { promises as fs } from "node:fs";
import path from "node:path";
import { atomicWrite, ensureDir } from "@/lib/admin/atomic";
import { ADMIN_ROOTS } from "@/lib/admin/paths";

/**
 * Shared ("dedup") donation photos — a handful of normalized WebP files
 * stored ONCE and LINKED to many finds, so a voucher covering e.g. 111
 * clovers doesn't need 111 physical copies. The photo bytes live flat in
 * `generated/find-photos/` under an `s_<sha1>_DAR[_ANON].webp` name:
 *
 *  - `s_` prefix — keeps the file OUT of the per-find reader regex
 *    (`^(\d+)…` in findPhotos.ts), so a shared photo is never mistaken for
 *    a per-find one.
 *  - `_ANON` suffix — makes Nginx 404 the file (same regex location as
 *    per-find anon photos), so an anonymized link never exposes the bytes.
 *  - public photos additionally get a `s_<sha1>_DAR.thumb.webp` thumbnail
 *    (anon photos get none — the modal shows a placeholder until unlock).
 *
 * This manifest maps find id → which shared photos it links (by sha1), in
 * which slot, and whether the link is anonymized. Stored in `data/.admin/`
 * like the note overrides: admin runtime state that survives the Mac→VPS
 * rsync and a full DB re-sync, and is read directly by the web (never
 * imported into the DB by sync).
 *
 * File shape:
 *   { "assignments": { "16330": [{ "slot": "a", "sha1": "…40hex…", "anon": false }] } }
 */

export interface DonationShareAssignment {
  /** `a`, `b`, … — gallery order, same meaning as a per-find photo slot. */
  slot: string;
  /** sha1 (40 hex) of the normalized web WebP — dedup key + filename stem. */
  sha1: string;
  /** Anonymized link: the web URL is withheld (Nginx 404s the file) and the
   *  detail modal shows a placeholder until the unlock code is entered. */
  anon: boolean;
}

export interface DonationSharesManifest {
  /** find id (as string key) → its shared-photo links. */
  assignments: Record<string, DonationShareAssignment[]>;
}

const ADMIN_DIR = path.join(ADMIN_ROOTS.meta, "..", ".admin");
const FILE = path.join(ADMIN_DIR, "donation-photo-shares.json");
const SHA1_RE = /^[0-9a-f]{40}$/;
const SLOT_RE = /^[a-z]$/;

/** Absolute path of the manifest — the reader stats it for cache freshness. */
export function donationSharesFilePath(): string {
  return FILE;
}

/** Web filename for a shared photo (public or anon variant). */
export function sharedPhotoFilename(sha1: string, anon: boolean): string {
  return `s_${sha1}_DAR${anon ? "_ANON" : ""}.webp`;
}

/** Thumbnail filename for a PUBLIC shared photo. Anon photos have no served
 *  thumb (the modal shows a placeholder), so this is only meaningful for
 *  `anon: false` links. */
export function sharedThumbFilename(sha1: string): string {
  return `s_${sha1}_DAR.thumb.webp`;
}

function cleanAssignment(v: unknown): DonationShareAssignment | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const slot = typeof o.slot === "string" ? o.slot.toLowerCase() : "";
  const sha1 = typeof o.sha1 === "string" ? o.sha1.toLowerCase() : "";
  if (!SLOT_RE.test(slot) || !SHA1_RE.test(sha1)) return null;
  return { slot, sha1, anon: o.anon === true };
}

/** Full manifest, tolerant of a missing/corrupt file (returns empty). */
export async function readDonationShares(): Promise<DonationSharesManifest> {
  let raw: string;
  try {
    raw = await fs.readFile(FILE, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT")
      return { assignments: {} };
    throw err;
  }
  const out: DonationSharesManifest = { assignments: {} };
  try {
    const parsed = JSON.parse(raw) as unknown;
    const asg = (parsed as { assignments?: unknown } | null)?.assignments;
    if (!asg || typeof asg !== "object") return out;
    for (const [k, v] of Object.entries(asg as Record<string, unknown>)) {
      const id = Number(k);
      if (!Number.isInteger(id) || id <= 0 || !Array.isArray(v)) continue;
      const list = v
        .map(cleanAssignment)
        .filter((x): x is DonationShareAssignment => x !== null);
      if (list.length > 0) out.assignments[String(id)] = list;
    }
  } catch {
    return { assignments: {} };
  }
  return out;
}

/** Overwrites the manifest atomically. Admin / server-action only — the web
 *  just reads. Serialised with ids sorted numerically and slots sorted, for
 *  stable, reviewable diffs. */
export async function writeDonationShares(
  manifest: DonationSharesManifest,
): Promise<void> {
  const obj: Record<string, DonationShareAssignment[]> = {};
  const ids = Object.keys(manifest.assignments)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .sort((a, b) => a - b);
  for (const id of ids) {
    const list = [...(manifest.assignments[String(id)] ?? [])].sort((a, b) =>
      a.slot.localeCompare(b.slot),
    );
    if (list.length > 0) obj[String(id)] = list;
  }
  await ensureDir(ADMIN_DIR);
  await atomicWrite(FILE, `${JSON.stringify({ assignments: obj }, null, 2)}\n`);
}
