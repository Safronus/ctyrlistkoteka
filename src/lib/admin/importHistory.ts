import { promises as fs } from "node:fs";
import path from "node:path";
import { ADMIN_ROOTS } from "./paths";
import { ensureDir } from "./atomic";

/**
 * What happened to every package that was ever handed to /admin/import.
 *
 * The import is a three-step conversation — upload, analyse, commit — and
 * the two ways it ends badly are invisible afterwards: a package the
 * operator looked at and cancelled, and one that failed. Without a record,
 * "did I already import this?" has no answer but memory, and "why is that
 * photo missing" starts with guessing whether the import ever ran.
 *
 * One line per event, appended: the file is a log, not a document, so a
 * crash mid-write can cost the last line and nothing else. Read back
 * newest-first and capped, because nobody scrolls a year of imports.
 */

export type ImportHistoryPackage = "v1" | "v2" | "photos" | "unknown";
export type ImportHistoryOutcome =
  /** Uploaded and analysed; the operator has not decided yet. */
  | "analyzed"
  /** Written. The summary line says what it did. */
  | "committed"
  /** The operator looked at the plan and backed out. */
  | "cancelled"
  /** Refused or broken — `error` says why. */
  | "failed";

export interface ImportHistoryEntry {
  /** ISO timestamp of the event. */
  at: string;
  /** Upload id, so the events of one package can be tied together. */
  uploadId: string;
  fileName: string;
  bytes: number;
  packageType: ImportHistoryPackage;
  outcome: ImportHistoryOutcome;
  /** One human line: "12 nálezů, 3 mapy" or "2 fotky pro 1 lokalitu". */
  summary?: string;
  error?: string;
}

const FILE_NAME = "import-history.jsonl";
/** Roughly a year of weekly imports — enough to answer "did I send this
 *  already", small enough to read in one go. */
const MAX_ENTRIES = 200;
/** Above this the file is rewritten down to MAX_ENTRIES. A log nobody
 *  ever prunes is a log that eventually fills a disk; 200 lines are well
 *  under 64 kB, so hitting this means something ran away. */
const REWRITE_OVER_BYTES = 256 * 1024;

export function historyFilePath(): string {
  return path.join(ADMIN_ROOTS.secure, FILE_NAME);
}

/**
 * Appends one event. Best-effort: the history is a convenience, and a
 * disk problem here must never take down the import it describes.
 */
export async function recordImportEvent(
  entry: Omit<ImportHistoryEntry, "at"> & { at?: string },
): Promise<void> {
  try {
    await ensureDir(path.dirname(historyFilePath()));
    const line = JSON.stringify({
      at: entry.at ?? new Date().toISOString(),
      ...entry,
    });
    await fs.appendFile(historyFilePath(), `${line}\n`, "utf8");
    await trimIfHuge();
  } catch (err) {
    console.warn("[admin/import] history append failed", err);
  }
}

/**
 * Rewrites the log down to the last MAX_ENTRIES once it grows past a size
 * no honest usage reaches.
 *
 * Deliberately not atomic and not on every append: losing this file costs
 * a convenience, and paying a read-plus-rewrite for each import to keep a
 * log tidy would be the tail wagging the dog.
 */
async function trimIfHuge(): Promise<void> {
  const file = historyFilePath();
  const stat = await fs.stat(file);
  if (stat.size <= REWRITE_OVER_BYTES) return;
  const lines = (await fs.readFile(file, "utf8"))
    .split("\n")
    .filter((l) => l.trim().length > 0);
  if (lines.length <= MAX_ENTRIES) return;
  await fs.writeFile(file, `${lines.slice(-MAX_ENTRIES).join("\n")}\n`, "utf8");
}

/**
 * The most recent events, newest first.
 *
 * One package usually produces two lines — analysed, then committed or
 * cancelled — and both are kept: "I looked at this and backed out" is
 * exactly the kind of thing worth seeing later.
 */
export async function readImportHistory(
  limit = 30,
): Promise<ImportHistoryEntry[]> {
  let raw: string;
  try {
    raw = await fs.readFile(historyFilePath(), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("[admin/import] history unreadable", err);
    }
    return [];
  }
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const out: ImportHistoryEntry[] = [];
  for (const line of lines.slice(-MAX_ENTRIES).reverse()) {
    try {
      const parsed = JSON.parse(line) as ImportHistoryEntry;
      if (typeof parsed.at === "string" && typeof parsed.fileName === "string") {
        out.push(parsed);
      }
    } catch {
      // A truncated last line from a crash — skip it, keep the rest.
    }
    if (out.length >= limit) break;
  }
  return out;
}
