"use server";

import { promises as fs } from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { atomicWrite, ensureDir, trashTimestamp } from "@/lib/admin/atomic";
import { appendAudit } from "@/lib/admin/audit";
import { formatJsonCompactArrays } from "@/lib/admin/jsonFormat";
import {
  LOKACE_STAVY_POZNAMKY_FILENAME,
  lokaceStavyPoznamkySchema,
  STAVY_KEYS,
  type LokaceStavyPoznamky,
} from "@/lib/admin/jsonSchema";
import { ADMIN_ROOTS } from "@/lib/admin/paths";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";
import { mergeRanges, type MergeConflict } from "./merge-action";

const META_TARGET_PATH = path.join(
  ADMIN_ROOTS.meta,
  LOKACE_STAVY_POZNAMKY_FILENAME,
);

/** Per-section diff after a whole-file merge. Each section's slot is
 *  populated independently so the UI can render four small "rolled-
 *  up" cards instead of one giant flat list. */
export interface WholeFileMergeSectionDiff {
  /** IDs newly added to this section's range fields. For poznamky
   *  this stays empty — poznamky uses key-level additions which
   *  go into `addedKeys`. */
  addedIds: number[];
  /** IDs that were already present in this section's existing
   *  ranges (no-op). */
  alreadyPresentIds: number[];
  /** Keys newly added — relevant for `poznamky` (find id keys) and
   *  `lokace` (map number keys). */
  addedKeys: string[];
  /** Keys already present with the same value. */
  alreadyPresentKeys: string[];
}

export interface WholeFileMergeResult {
  ok: boolean;
  /** Per-section breakdown when ok = true. Conflicts (poznamky with
   *  diverging text) abort the whole merge before reaching this
   *  state. */
  sections?: {
    anonymizace: WholeFileMergeSectionDiff;
    stavy: WholeFileMergeSectionDiff;
    poznamky: WholeFileMergeSectionDiff;
    lokace: WholeFileMergeSectionDiff;
  };
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
 *  Input must match the full schema (lokace + stavy + poznamky +
 *  anonymizace, all four required). Use the section-specific merge
 *  action when feeding a fragment. */
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

  const incomingResult = lokaceStavyPoznamkySchema.safeParse(incomingParsed);
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
  const existingResult = lokaceStavyPoznamkySchema.safeParse(existingParsed);
  if (!existingResult.success) {
    return {
      ok: false,
      error:
        "Existující JSON neprošel Zod validací — uprav ho přes editor a ulož znovu.",
    };
  }
  const existing = existingResult.data;

  const merged: LokaceStavyPoznamky = {
    anonymizace: { ANONYMIZOVANE: [...existing.anonymizace.ANONYMIZOVANE] },
    stavy: { ...existing.stavy } as LokaceStavyPoznamky["stavy"],
    poznamky: { ...existing.poznamky },
    lokace: { ...existing.lokace },
  };

  const sections: WholeFileMergeResult["sections"] = {
    anonymizace: emptyDiff(),
    stavy: emptyDiff(),
    poznamky: emptyDiff(),
    lokace: emptyDiff(),
  };

  // ── anonymizace ────────────────────────────────────────────────
  {
    const r = mergeRanges(
      merged.anonymizace.ANONYMIZOVANE,
      incoming.anonymizace.ANONYMIZOVANE,
    );
    merged.anonymizace = { ANONYMIZOVANE: r.merged };
    sections.anonymizace.addedIds = r.added;
    sections.anonymizace.alreadyPresentIds = r.alreadyPresent;
  }

  // ── stavy.<KEY> per key ─────────────────────────────────────────
  for (const key of STAVY_KEYS) {
    const incomingArr = incoming.stavy[key as keyof typeof incoming.stavy];
    if (!incomingArr || incomingArr.length === 0) continue;
    const existingArr =
      (merged.stavy[key as keyof typeof merged.stavy] as string[] | undefined) ??
      [];
    const r = mergeRanges(existingArr, incomingArr);
    (merged.stavy as Record<string, string[]>)[key] = r.merged;
    sections.stavy.addedIds.push(...r.added);
    sections.stavy.alreadyPresentIds.push(...r.alreadyPresent);
  }
  sections.stavy.addedIds = uniqueSortAsc(sections.stavy.addedIds);
  sections.stavy.alreadyPresentIds = uniqueSortAsc(
    sections.stavy.alreadyPresentIds,
  );

  // ── poznamky ───────────────────────────────────────────────────
  const conflicts: MergeConflict[] = [];
  for (const [key, value] of Object.entries(incoming.poznamky)) {
    if (key in merged.poznamky) {
      const current = merged.poznamky[key]!;
      if (current === value) {
        sections.poznamky.alreadyPresentKeys.push(key);
      } else {
        conflicts.push({
          path: `poznamky["${key}"]`,
          existing: current,
          incoming: value,
        });
      }
    } else {
      merged.poznamky[key] = value;
      sections.poznamky.addedKeys.push(key);
    }
  }

  // ── lokace.<CODE> per code ─────────────────────────────────────
  for (const [code, ranges] of Object.entries(incoming.lokace)) {
    const isNewCode = !(code in merged.lokace);
    const existingArr = merged.lokace[code] ?? [];
    const r = mergeRanges(existingArr, ranges);
    merged.lokace[code] = r.merged;
    sections.lokace.addedIds.push(...r.added);
    sections.lokace.alreadyPresentIds.push(...r.alreadyPresent);
    if (isNewCode) sections.lokace.addedKeys.push(code);
  }
  sections.lokace.addedIds = uniqueSortAsc(sections.lokace.addedIds);
  sections.lokace.alreadyPresentIds = uniqueSortAsc(
    sections.lokace.alreadyPresentIds,
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

  const totalChanges =
    sections.anonymizace.addedIds.length +
    sections.stavy.addedIds.length +
    sections.poznamky.addedKeys.length +
    sections.lokace.addedIds.length +
    sections.lokace.addedKeys.length;
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
      error: `Backup do .trash selhal: ${(err as Error).message}`,
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

function emptyDiff(): WholeFileMergeSectionDiff {
  return {
    addedIds: [],
    alreadyPresentIds: [],
    addedKeys: [],
    alreadyPresentKeys: [],
  };
}

function uniqueSortAsc(arr: number[]): number[] {
  return [...new Set(arr)].sort((a, b) => a - b);
}
