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
   *  segments (e.g. ["stavy", "DAROVANY", 3]) so the editor can
   *  highlight the offending row. */
  issues?: { path: (string | number)[]; message: string }[];
  /** When the input couldn't be parsed as JSON, the parse error
   *  message and 1-based line/col when extractable. */
  parseError?: { message: string; line?: number; column?: number };
}

const META_TARGET_PATH = path.join(
  ADMIN_ROOTS.meta,
  LOKACE_STAVY_POZNAMKY_FILENAME,
);

/** Server action invoked from the editor. Auth → JSON.parse → Zod
 *  validate → snapshot the current file into `data/.trash/<ts>/meta/`
 *  → atomic write of the new content → audit. Failures short-circuit
 *  before any disk write, so the live file never ends up in a
 *  half-validated state. */
export async function saveLokaceStavyPoznamky(
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
  if (raw.length === 0) {
    return { ok: false, error: "Prázdný obsah — soubor by se znegoval" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // V8's SyntaxError messages are like "Unexpected token ... in JSON
    // at position 1234". Pull the position out so the editor can
    // jump-to. Line/col from position requires walking the source.
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
    return {
      ok: false,
      parseError: { message, line, column },
    };
  }

  const result = lokaceStavyPoznamkySchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues.map((i) => ({
        path: [...i.path] as (string | number)[],
        message: i.message,
      })),
    };
  }

  // Re-serialise from the validated object so we drop any unknown
  // top-level keys that strict() didn't reject (it does), normalise
  // whitespace, and produce a stable diff-friendly format. Keys are
  // emitted in the order Zod returned them — matches the schema
  // declaration order, which is also the historical file order.
  const formatted = formatJsonCompactArrays(result.data) + "\n";

  // Snapshot the current file into trash before overwriting. Preserves
  // an undo path even though the editor itself doesn't surface one.
  try {
    await fs.access(META_TARGET_PATH);
    const trashDir = path.join(ADMIN_ROOTS.trash, trashTimestamp(), "meta");
    await ensureDir(trashDir);
    await fs.copyFile(
      META_TARGET_PATH,
      path.join(trashDir, LOKACE_STAVY_POZNAMKY_FILENAME),
    );
  } catch (err) {
    // ENOENT = file didn't exist yet (first save). Anything else is
    // a real error we should surface rather than silently losing the
    // backup.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[admin/json] backup failed", { message });
      return { ok: false, error: `Backup do .trash selhal: ${message}` };
    }
  }

  await ensureDir(ADMIN_ROOTS.meta);
  await atomicWrite(META_TARGET_PATH, formatted);

  await appendAudit({
    action: "json.update",
    ip,
    credentialLabel,
    details: {
      file: LOKACE_STAVY_POZNAMKY_FILENAME,
      bytes: Buffer.byteLength(formatted, "utf8"),
      stavyKeys: Object.keys(result.data.stavy),
      lokaceCount: Object.keys(result.data.lokace).length,
      poznamkyCount: Object.keys(result.data.poznamky).length,
      anonymizovaneCount: result.data.anonymizace.ANONYMIZOVANE.length,
    },
  });

  revalidatePath("/admin/files/meta");
  revalidatePath("/admin/json/lokace-stavy-poznamky");
  return { ok: true, savedAt: new Date().toISOString() };
}
