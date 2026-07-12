"use server";

import { promises as fs } from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { atomicWrite, ensureDir, trashTimestamp } from "@/lib/admin/atomic";
import { appendAudit } from "@/lib/admin/audit";
import { formatJsonCompactArrays } from "@/lib/admin/jsonFormat";
import {
  LOKACE_STAVY_POZNAMKY_FILENAME,
  lokaceStavyPoznamkyMergeInputSchema,
  lokaceStavyPoznamkySchema,
} from "@/lib/admin/jsonSchema";
import {
  computeWholeFileMerge,
  type MergeConflict,
  type WholeFileMergeSections,
} from "@/lib/admin/lspMerge";
import { createBackup } from "@/lib/admin/lspBackups";
import { ADMIN_ROOTS } from "@/lib/admin/paths";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";

const META_TARGET_PATH = path.join(
  ADMIN_ROOTS.meta,
  LOKACE_STAVY_POZNAMKY_FILENAME,
);

// The per-section diff shapes (WholeFileMergeSectionDiff /
// WholeFileMergeSections) live in @/lib/admin/lspMerge, shared with the
// package-import analyze step.
export interface WholeFileMergeResult {
  ok: boolean;
  /** Per-section breakdown when ok = true. Conflicts (poznamky with
   *  diverging text) abort the whole merge before reaching this
   *  state. */
  sections?: WholeFileMergeSections;
  /** True when the input was valid but didn't add anything new
   *  anywhere. */
  noChanges?: boolean;
  /** poznamky-section conflicts — same key, different value. Whole
   *  merge fails when this is non-empty. */
  conflicts?: MergeConflict[];
  error?: string;
  parseError?: { message: string; line?: number; column?: number };
  issues?: { path: (string | number)[]; message: string }[];
}

/** Bulk additive merge of an entire LokaceStavyPoznamky.json shape
 *  into the live file. Same rules as the per-section action — range
 *  fields union, poznamky key union with conflict detection — just
 *  applied across all four sections at once.
 *
 *  Input is parsed leniently: any subset of the four sections is fine
 *  (omitted sections are left untouched) and an unknown `metadata`
 *  block (e.g. from the PDF exporter) is stripped rather than rejected.
 *  The fully-merged result is still validated against the strict schema
 *  before writing. A rotating backup is taken first (see lspBackups). */
export async function mergeWholeFile(
  formData: FormData,
): Promise<WholeFileMergeResult> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    return { ok: false, error: "Unauthenticated" };
  }
  const credentialLabel = session.credentialLabel!;
  const ip = await getRequestIp();
  await touchSession();

  const contentRaw = formData.get("content");
  if (typeof contentRaw !== "string") {
    return { ok: false, error: "Chybí pole `content`" };
  }
  if (contentRaw.trim().length === 0) {
    return { ok: false, error: "Vstup je prázdný" };
  }

  let incomingParsed: unknown;
  try {
    incomingParsed = JSON.parse(contentRaw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const posMatch = /position (\d+)/.exec(message);
    let line: number | undefined;
    let column: number | undefined;
    if (posMatch) {
      const pos = Number(posMatch[1]);
      let l = 1;
      let c = 1;
      for (let i = 0; i < pos && i < contentRaw.length; i++) {
        if (contentRaw[i] === "\n") {
          l += 1;
          c = 1;
        } else {
          c += 1;
        }
      }
      line = l;
      column = c;
    }
    return { ok: false, parseError: { message, line, column } };
  }

  // Lenient: sections are optional (paste only what you're changing)
  // and a stray `metadata` block from the exporter is stripped.
  const incomingResult =
    lokaceStavyPoznamkyMergeInputSchema.safeParse(incomingParsed);
  if (!incomingResult.success) {
    return {
      ok: false,
      issues: incomingResult.error.issues.map((i) => ({
        path: [...i.path] as (string | number)[],
        message: i.message,
      })),
    };
  }
  const incoming = incomingResult.data;

  let existingRaw: string;
  try {
    existingRaw = await fs.readFile(META_TARGET_PATH, "utf8");
  } catch (err) {
    return {
      ok: false,
      error: `Nelze načíst LokaceStavyPoznamky.json: ${(err as Error).message}`,
    };
  }
  let existingParsed: unknown;
  try {
    existingParsed = JSON.parse(existingRaw);
  } catch (err) {
    return {
      ok: false,
      error: `Existující JSON není validní: ${(err as Error).message}`,
    };
  }
  // Same lenient parse for the live file — tolerates a `metadata` block
  // that may have been rsynced in, and any section being absent.
  const existingResult =
    lokaceStavyPoznamkyMergeInputSchema.safeParse(existingParsed);
  if (!existingResult.success) {
    return {
      ok: false,
      error:
        "Existující JSON neprošel Zod validací — uprav ho přes editor a ulož znovu.",
    };
  }
  const existing = existingResult.data;

  // Pure additive union of all four sections (shared with the package-import
  // analyze dry-run) — no I/O, returns the merged object + per-section diff.
  const { merged, sections, conflicts, totalChanges } = computeWholeFileMerge(
    incoming,
    existing,
  );

  if (conflicts.length > 0) {
    return {
      ok: false,
      sections,
      conflicts,
      error:
        "Některé klíče existují s jinou hodnotou — nejdřív vyřeš konflikty v editoru, pak merge zopakuj.",
    };
  }

  if (totalChanges === 0) {
    return { ok: true, sections, noChanges: true };
  }

  const finalCheck = lokaceStavyPoznamkySchema.safeParse(merged);
  if (!finalCheck.success) {
    return {
      ok: false,
      sections,
      error: `Vnitřní chyba — sloučený JSON neprošel finální validací: ${finalCheck.error.issues
        .slice(0, 3)
        .map((i) => i.message)
        .join("; ")}`,
    };
  }
  const formatted = formatJsonCompactArrays(finalCheck.data) + "\n";

  try {
    // Rotating backup (last 10, restorable from the editor page) +
    // the CLAUDE.md §9 .trash snapshot.
    await createBackup();
    const trashDir = path.join(ADMIN_ROOTS.trash, trashTimestamp(), "meta");
    await ensureDir(trashDir);
    await fs.copyFile(
      META_TARGET_PATH,
      path.join(trashDir, LOKACE_STAVY_POZNAMKY_FILENAME),
    );
  } catch (err) {
    return {
      ok: false,
      sections,
      error: `Záloha selhala: ${(err as Error).message}`,
    };
  }

  await ensureDir(ADMIN_ROOTS.meta);
  await atomicWrite(META_TARGET_PATH, formatted);

  await appendAudit({
    action: "json.update",
    ip,
    credentialLabel,
    details: {
      file: LOKACE_STAVY_POZNAMKY_FILENAME,
      reason: "merge-whole-file",
      anonymizaceAddedCount: sections.anonymizace.addedIds.length,
      stavyAddedCount: sections.stavy.addedIds.length,
      poznamkyAddedCount: sections.poznamky.addedKeys.length,
      lokaceAddedKeyCount: sections.lokace.addedKeys.length,
      lokaceAddedIdCount: sections.lokace.addedIds.length,
    },
  });

  revalidatePath("/admin/files/meta");
  revalidatePath("/admin/json/lokace-stavy-poznamky");
  revalidatePath(
    `/admin/files/meta/${encodeURIComponent(LOKACE_STAVY_POZNAMKY_FILENAME)}`,
  );

  return { ok: true, sections, noChanges: false };
}
