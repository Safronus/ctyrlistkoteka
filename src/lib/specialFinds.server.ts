import { promises as fs } from "node:fs";
import path from "node:path";
import { ADMIN_ROOTS } from "@/lib/admin/paths";
import { RECORD_FIND_ID } from "@/lib/constants";
import { specialFindsSchema, type SpecialFind } from "./specialFinds";

/**
 * Server-only filesystem side of the special-find assignments. Stored as
 * a tiny JSON under `data/.admin/` (admin-internal config, next to the
 * home-rotation settings — not collection data), atomically written by
 * the admin action and read by the find-detail page + /statistiky.
 *
 * When the file is missing it falls back to the built-in defaults so the
 * 111 / 666 / record finds keep their effects on a fresh deploy. Once the
 * admin edits anything, the file becomes the single source of truth.
 */

export const SPECIAL_FINDS_DIR = path.dirname(ADMIN_ROOTS.backups);
export const SPECIAL_FINDS_PATH = path.join(
  SPECIAL_FINDS_DIR,
  "special-finds.json",
);

const DEFAULTS: SpecialFind[] = [
  { findId: 111, effect: "heavenly" },
  { findId: 666, effect: "hellish" },
  { findId: RECORD_FIND_ID, effect: "record" },
];

/** Read the current assignments. Missing/invalid file → built-in
 *  defaults. Deduped by findId (last wins). Never throws. */
export async function getSpecialFinds(): Promise<SpecialFind[]> {
  try {
    const raw = await fs.readFile(SPECIAL_FINDS_PATH, "utf8");
    const parsed = specialFindsSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return [...DEFAULTS];
    const byId = new Map(parsed.data.map((s) => [s.findId, s]));
    return [...byId.values()].sort((a, b) => a.findId - b.findId);
  } catch {
    return [...DEFAULTS];
  }
}
