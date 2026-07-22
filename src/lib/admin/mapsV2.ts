/**
 * Helpers for the location-map **v2 web package** as it sits on disk under
 * `data/maps/` (`manifest.json` + `Nosné mapy/` + `Rendered mapy/`).
 *
 * The v2 package is authoritative and managed as a whole through
 * `/admin/import` (the ZIP flow → `phaseMapsV2` in sync). The legacy
 * per-file admin actions (delete / rename / mark-nonexistent / replace /
 * anonymize) were written for the flat v1 filename convention and must never
 * touch the v2 artifacts — trashing `manifest.json` or renaming the
 * `Nosné mapy` tree silently breaks `pnpm sync`. This module is the single
 * guard that keeps those actions off the v2 package.
 */

/** Names directly inside `data/maps/` that belong to the v2 package. Compared
 *  NFC + lowercased so an rsync-from-macOS NFD form or a case slip still
 *  matches. The two directory names are here for defence-in-depth — the
 *  per-file actions already reject non-files — plus a clear error message. */
const V2_RESERVED_NFC: ReadonlySet<string> = new Set([
  "manifest.json",
  "nosné mapy",
  "rendered mapy",
]);

/** True when `name` is a v2-package artifact that per-file map actions must
 *  refuse (manifest.json or the Nosné/Rendered mapy directories). */
export function isV2ReservedMapName(name: string): boolean {
  return V2_RESERVED_NFC.has(name.normalize("NFC").toLowerCase());
}

/** Throws when `name` is a v2-package artifact. Call at the top of every
 *  mutating maps action (right after `safeBaseName`) so a stray delete /
 *  rename / replace can't corrupt the v2 package. Managed via /admin/import. */
export function assertMutableMapFile(name: string): void {
  if (isV2ReservedMapName(name)) {
    throw new Error(
      `„${name}" patří k balíčku map verze 2 (manifest.json / Nosné mapy / Rendered mapy) — přes tuto akci ho nelze mazat ani měnit. Mapy verze 2 se spravují jako celek přes /admin/import.`,
    );
  }
}
