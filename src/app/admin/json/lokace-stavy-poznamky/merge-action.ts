"use server";

import { promises as fs } from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { atomicWrite, ensureDir, trashTimestamp } from "@/lib/admin/atomic";
import { appendAudit } from "@/lib/admin/audit";
import { formatJsonCompactArrays } from "@/lib/admin/jsonFormat";
import {
  anonymizaceSchema,
  lokaceSchema,
  LOKACE_STAVY_POZNAMKY_FILENAME,
  lokaceStavyPoznamkySchema,
  poznamkySchema,
  SECTION_KEYS,
  STAVY_KEYS,
  type SectionKey,
} from "@/lib/admin/jsonSchema";
import { ADMIN_ROOTS } from "@/lib/admin/paths";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";
import { mergeRanges } from "./merge-ranges";

const META_TARGET_PATH = path.join(
  ADMIN_ROOTS.meta,
  LOKACE_STAVY_POZNAMKY_FILENAME,
);

/** Range field rules — same as jsonSchema.ts but inlined here so the
 *  partial-stavy variant below can pull from the same definition.
 *  Keep in sync if jsonSchema.ts changes. */
const rangesField = z.array(z.string()).superRefine((arr, ctx) => {
  arr.forEach((raw, i) => {
    const s = raw.trim();
    if (s === "") return;
    if (/^\d+$/.test(s)) return;
    const range = /^(\d+)-(\d+)$/.exec(s);
    if (!range) {
      ctx.addIssue({
        code: "custom",
        message: `Neplatný range "${s}" — povolené formáty: "15" nebo "15-35"`,
        path: [i],
      });
      return;
    }
    const a = Number(range[1]);
    const b = Number(range[2]);
    if (a > b) {
      ctx.addIssue({
        code: "custom",
        message: `Range "${s}": začátek je větší než konec`,
        path: [i],
      });
    }
  });
});

/** Partial variant of stavy — every STAVY_KEY is optional, but unknown
 *  keys are still rejected. Lets the merge form accept e.g.
 *  `{ "DAROVANY": ["12345"] }` without requiring the user to repeat
 *  every other state's existing array verbatim. */
const partialStavyShape: Record<string, typeof rangesField> = {};
for (const k of STAVY_KEYS) partialStavyShape[k] = rangesField;
const partialStavySchema = z.object(
  Object.fromEntries(
    Object.entries(partialStavyShape).map(([k, v]) => [k, v.optional()]),
  ),
).strict();

function getMergeInputSchema(section: SectionKey) {
  switch (section) {
    case "anonymizace":
      return anonymizaceSchema;
    case "stavy":
      return partialStavySchema;
    case "poznamky":
      return poznamkySchema;
    case "lokace":
      return lokaceSchema;
  }
}

export interface MergeConflict {
  /** Human-readable JSON pointer ("poznamky[12345]") */
  path: string;
  existing: string;
  incoming: string;
}

export interface MergeSectionResult {
  ok: boolean;
  section?: SectionKey;
  /** Numbers added to a range field (anonymizace / stavy.* / lokace.code). */
  addedIds?: number[];
  /** Numbers that were already covered by existing ranges. */
  alreadyPresentIds?: number[];
  /** Object keys (poznamky id, lokace code) that were newly inserted. */
  addedKeys?: string[];
  /** Object keys that already existed with the same value — no-op. */
  alreadyPresentKeys?: string[];
  /** Object keys with a value mismatch — surfaced for review. The
   *  whole merge fails if conflicts are non-empty. */
  conflicts?: MergeConflict[];
  /** True when the merge produced no changes (all incoming was
   *  already present). The page still refreshes for consistency. */
  noChanges?: boolean;
  error?: string;
  parseError?: { message: string; line?: number; column?: number };
  issues?: { path: (string | number)[]; message: string }[];
}

/** Merges the supplied JSON fragment into one section of
 *  LokaceStavyPoznamky.json. Each section's merge rule:
 *
 *    anonymizace → range union (parseRanges → set union → compactToRanges)
 *    stavy.<KEY> → range union per key, only specified keys touched
 *    poznamky    → object key union; same key + same value = no-op,
 *                  same key + different value = conflict, fails the
 *                  whole merge
 *    lokace.<CODE> → range union per code; new codes added
 *
 *  Snapshot of the previous file goes to data/.trash/<ts>/meta/
 *  before the atomic write, mirroring the editor's save action. */
export async function mergeSectionInto(
  formData: FormData,
): Promise<MergeSectionResult> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    return { ok: false, error: "Unauthenticated" };
  }
  const credentialLabel = session.credentialLabel!;
  const ip = await getRequestIp();
  await touchSession();

  const sectionRaw = formData.get("section");
  if (typeof sectionRaw !== "string" || !SECTION_KEYS.includes(sectionRaw as SectionKey)) {
    return { ok: false, error: `Neznámá sekce: ${sectionRaw}` };
  }
  const section = sectionRaw as SectionKey;

  const contentRaw = formData.get("content");
  if (typeof contentRaw !== "string") {
    return { ok: false, section, error: "Chybí pole `content`" };
  }
  if (contentRaw.trim().length === 0) {
    return { ok: false, section, error: "Vstup je prázdný" };
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
    return {
      ok: false,
      section,
      parseError: { message, line, column },
    };
  }

  const inputSchema = getMergeInputSchema(section);
  const incomingResult = inputSchema.safeParse(incomingParsed);
  if (!incomingResult.success) {
    return {
      ok: false,
      section,
      issues: incomingResult.error.issues.map((i) => ({
        path: [...i.path] as (string | number)[],
        message: i.message,
      })),
    };
  }

  let existingRaw: string;
  try {
    existingRaw = await fs.readFile(META_TARGET_PATH, "utf8");
  } catch (err) {
    return {
      ok: false,
      section,
      error: `Nelze načíst LokaceStavyPoznamky.json: ${(err as Error).message}`,
    };
  }
  let existingParsed: unknown;
  try {
    existingParsed = JSON.parse(existingRaw);
  } catch (err) {
    return {
      ok: false,
      section,
      error: `Existující JSON není validní: ${(err as Error).message}`,
    };
  }
  const existingResult = lokaceStavyPoznamkySchema.safeParse(existingParsed);
  if (!existingResult.success) {
    return {
      ok: false,
      section,
      error:
        "Existující JSON neprošel Zod validací — uprav ho přes editor a ulož znovu.",
    };
  }
  const existing = existingResult.data;

  const merged: typeof existing = {
    anonymizace: { ANONYMIZOVANE: [...existing.anonymizace.ANONYMIZOVANE] },
    stavy: { ...existing.stavy } as typeof existing.stavy,
    poznamky: { ...existing.poznamky },
    lokace: { ...existing.lokace },
  };

  const addedIds: number[] = [];
  const alreadyPresentIds: number[] = [];
  const addedKeys: string[] = [];
  const alreadyPresentKeys: string[] = [];
  const conflicts: MergeConflict[] = [];

  if (section === "anonymizace") {
    const data = incomingResult.data as z.infer<typeof anonymizaceSchema>;
    const m = mergeRanges(merged.anonymizace.ANONYMIZOVANE, data.ANONYMIZOVANE);
    merged.anonymizace = { ANONYMIZOVANE: m.merged };
    addedIds.push(...m.added);
    alreadyPresentIds.push(...m.alreadyPresent);
  } else if (section === "stavy") {
    const data = incomingResult.data as Record<string, string[] | undefined>;
    for (const [key, ranges] of Object.entries(data)) {
      if (!ranges) continue;
      const existingArr =
        (merged.stavy[key as keyof typeof merged.stavy] as string[] | undefined) ?? [];
      const m = mergeRanges(existingArr, ranges);
      (merged.stavy as Record<string, string[]>)[key] = m.merged;
      addedIds.push(...m.added);
      alreadyPresentIds.push(...m.alreadyPresent);
    }
  } else if (section === "poznamky") {
    const data = incomingResult.data as Record<string, string>;
    for (const [key, value] of Object.entries(data)) {
      if (key in merged.poznamky) {
        const current = merged.poznamky[key]!;
        if (current === value) {
          alreadyPresentKeys.push(key);
        } else {
          conflicts.push({
            path: `poznamky["${key}"]`,
            existing: current,
            incoming: value,
          });
        }
      } else {
        merged.poznamky[key] = value;
        addedKeys.push(key);
      }
    }
  } else if (section === "lokace") {
    const data = incomingResult.data as Record<string, string[]>;
    for (const [code, ranges] of Object.entries(data)) {
      const isNewCode = !(code in merged.lokace);
      const existingArr = merged.lokace[code] ?? [];
      const m = mergeRanges(existingArr, ranges);
      merged.lokace[code] = m.merged;
      addedIds.push(...m.added);
      alreadyPresentIds.push(...m.alreadyPresent);
      if (isNewCode) addedKeys.push(code);
    }
  }

  if (conflicts.length > 0) {
    return {
      ok: false,
      section,
      addedIds,
      alreadyPresentIds,
      addedKeys,
      alreadyPresentKeys,
      conflicts,
      error:
        "Některé klíče existují s jinou hodnotou — nejdřív vyřeš konflikty v editoru, pak merge zopakuj.",
    };
  }

  const noChanges =
    addedIds.length === 0 &&
    addedKeys.length === 0;
  if (noChanges) {
    return {
      ok: true,
      section,
      addedIds,
      alreadyPresentIds,
      addedKeys,
      alreadyPresentKeys,
      conflicts: [],
      noChanges: true,
    };
  }

  const finalCheck = lokaceStavyPoznamkySchema.safeParse(merged);
  if (!finalCheck.success) {
    return {
      ok: false,
      section,
      error: `Vnitřní chyba — sloučený JSON neprošel finální validací: ${finalCheck.error.issues
        .slice(0, 3)
        .map((i) => i.message)
        .join("; ")}`,
    };
  }
  const formatted = formatJsonCompactArrays(finalCheck.data) + "\n";

  try {
    const trashDir = path.join(
      ADMIN_ROOTS.trash,
      trashTimestamp(),
      "meta",
    );
    await ensureDir(trashDir);
    await fs.copyFile(
      META_TARGET_PATH,
      path.join(trashDir, LOKACE_STAVY_POZNAMKY_FILENAME),
    );
  } catch (err) {
    return {
      ok: false,
      section,
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
      reason: "merge-into-section",
      section,
      addedIdCount: addedIds.length,
      alreadyPresentIdCount: alreadyPresentIds.length,
      addedKeyCount: addedKeys.length,
      alreadyPresentKeyCount: alreadyPresentKeys.length,
    },
  });

  revalidatePath("/admin/files/meta");
  revalidatePath("/admin/json/lokace-stavy-poznamky");
  revalidatePath(
    `/admin/files/meta/${encodeURIComponent(LOKACE_STAVY_POZNAMKY_FILENAME)}`,
  );

  return {
    ok: true,
    section,
    addedIds,
    alreadyPresentIds,
    addedKeys,
    alreadyPresentKeys,
    conflicts: [],
    noChanges: false,
  };
}

