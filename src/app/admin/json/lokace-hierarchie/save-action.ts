"use server";

import { promises as fs } from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { atomicWrite, ensureDir, trashTimestamp } from "@/lib/admin/atomic";
import { appendAudit } from "@/lib/admin/audit";
import { prisma } from "@/lib/db";
import { formatJsonCompactArrays } from "@/lib/admin/jsonFormat";
import {
  LOKACE_HIERARCHIE_FILENAME,
  lokaceHierarchieSchema,
} from "@/lib/admin/jsonSchema";
import { ADMIN_ROOTS } from "@/lib/admin/paths";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";

export interface SaveResult {
  ok: boolean;
  /** ISO timestamp on success — the client uses it to render a
   *  "Uloženo HH:MM:SS" toast. */
  savedAt?: string;
  /** Top-level error message when the save failed for a reason that
   *  isn't tied to a particular field. */
  error?: string;
  /** Field-level Zod issues. Each issue's `path` is the JSON pointer
   *  segments (e.g. ["RATIBOŘ_POLE001", 3]) so the editor can
   *  highlight the offending row. */
  issues?: { path: (string | number)[]; message: string }[];
  /** When the input couldn't be parsed as JSON, the parse error
   *  message and 1-based line/col when extractable. */
  parseError?: { message: string; line?: number; column?: number };
}

const TARGET_PATH = path.join(ADMIN_ROOTS.meta, LOKACE_HIERARCHIE_FILENAME);

/** Server action invoked from the editor. Auth → JSON.parse → Zod
 *  validate → DB referential check (every code must exist) → snapshot
 *  to `data/.trash/<ts>/meta/` → atomic write → audit. Failures
 *  short-circuit before any disk write, so the live file never ends
 *  up in a half-validated state. */
export async function saveLokaceHierarchie(
  formData: FormData,
): Promise<SaveResult> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    return { ok: false, error: "Unauthenticated" };
  }
  const credentialLabel = session.credentialLabel!;
  const ip = await getRequestIp();
  await touchSession();

  const raw = formData.get("content");
  if (typeof raw !== "string") {
    return { ok: false, error: "Chybí pole `content`" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const posMatch = /position (\d+)/.exec(message);
    let line: number | undefined;
    let column: number | undefined;
    if (posMatch) {
      const pos = Number(posMatch[1]);
      let l = 1;
      let c = 1;
      for (let i = 0; i < pos && i < raw.length; i++) {
        if (raw[i] === "\n") {
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

  const result = lokaceHierarchieSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues.map((i) => ({
        path: [...i.path] as (string | number)[],
        message: i.message,
      })),
    };
  }

  // Referential validation: every code (parent or child) must exist
  // in `locations`. The structural schema only checks shape; without
  // this step a typo'd code would land in the JSON and only blow up
  // on the next `pnpm sync` run.
  const codesInJson = new Set<string>();
  for (const [parent, children] of Object.entries(result.data)) {
    codesInJson.add(parent);
    for (const c of children) codesInJson.add(c);
  }
  if (codesInJson.size > 0) {
    const existing = await prisma.location.findMany({
      where: { code: { in: Array.from(codesInJson) } },
      select: { code: true },
    });
    const existingSet = new Set(existing.map((r) => r.code));
    const issues: { path: (string | number)[]; message: string }[] = [];
    for (const [parent, children] of Object.entries(result.data)) {
      if (!existingSet.has(parent)) {
        issues.push({
          path: [parent],
          message: `Rodičovská lokace "${parent}" neexistuje v DB`,
        });
      }
      children.forEach((child, i) => {
        if (!existingSet.has(child)) {
          issues.push({
            path: [parent, i],
            message: `Dětská lokace "${child}" neexistuje v DB`,
          });
        }
      });
    }
    if (issues.length > 0) {
      return { ok: false, issues };
    }
  }

  // Empty object is valid (means "no hierarchy"). Re-serialise from
  // the validated data to drop unknown keys + normalise whitespace.
  // Object.entries order preserves insertion order in V8, matching
  // what the editor produced.
  const formatted = formatJsonCompactArrays(result.data) + "\n";

  // Snapshot current file into trash before overwriting.
  try {
    await fs.access(TARGET_PATH);
    const trashDir = path.join(ADMIN_ROOTS.trash, trashTimestamp(), "meta");
    await ensureDir(trashDir);
    await fs.copyFile(
      TARGET_PATH,
      path.join(trashDir, LOKACE_HIERARCHIE_FILENAME),
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[admin/json] hierarchie backup failed", { message });
      return { ok: false, error: `Backup do .trash selhal: ${message}` };
    }
  }

  await ensureDir(ADMIN_ROOTS.meta);
  await atomicWrite(TARGET_PATH, formatted);

  const parentCount = Object.keys(result.data).length;
  const childCount = Object.values(result.data).reduce(
    (sum, arr) => sum + arr.length,
    0,
  );

  await appendAudit({
    action: "json.update",
    ip,
    credentialLabel,
    details: {
      file: LOKACE_HIERARCHIE_FILENAME,
      bytes: Buffer.byteLength(formatted, "utf8"),
      parentCount,
      childCount,
    },
  });

  revalidatePath("/admin/files/meta");
  revalidatePath("/admin/json/lokace-hierarchie");
  return { ok: true, savedAt: new Date().toISOString() };
}
