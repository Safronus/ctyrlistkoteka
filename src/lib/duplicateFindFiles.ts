import { parseFindFilename } from "./parseFilename";

/** The short crop form `<id>.jpg` — the same relaxation sync accepts. */
const SHORT_CROP_RE = /^(\d+)\.(jpe?g)$/i;

export interface DuplicateFindFiles {
  findId: number;
  /** Every file of this find in the directory, in the order sync reads them. */
  files: string[];
  /** The one sync actually uses — the LAST in that order. */
  used: string;
}

/**
 * Finds that have more than one photo of the same kind in one directory
 * (data/finds/ or data/crops/).
 *
 * Sync keeps exactly one file per find and kind: it reads the directory
 * sorted (plain `.sort()`, the order `listFiles` in scripts/sync.ts uses)
 * and the last file wins. The others are silently ignored — so a stale
 * photo left next to its corrected twin decides nothing, but can quietly
 * win again after a rename. Reporting them is the point of this helper; it
 * never picks a different winner than sync does.
 *
 * Names that don't parse are not this helper's concern (sync reports those
 * as `parse_error`).
 */
export function duplicateFindFiles(
  names: readonly string[],
  opts: { shortCropForm: boolean },
): DuplicateFindFiles[] {
  const byId = new Map<number, string[]>();
  for (const name of [...names].sort()) {
    const id = findIdOfPhoto(name, opts.shortCropForm);
    if (id === null) continue;
    const list = byId.get(id);
    if (list) list.push(name);
    else byId.set(id, [name]);
  }
  const out: DuplicateFindFiles[] = [];
  for (const [findId, files] of byId) {
    if (files.length > 1) out.push({ findId, files, used: files.at(-1)! });
  }
  return out.sort((a, b) => a.findId - b.findId);
}

function findIdOfPhoto(name: string, shortCropForm: boolean): number | null {
  const parsed = parseFindFilename(name);
  if (parsed.ok) return parsed.value.findId;
  if (!shortCropForm) return null;
  const short = SHORT_CROP_RE.exec(name.normalize("NFC"));
  return short ? Number(short[1]) : null;
}
