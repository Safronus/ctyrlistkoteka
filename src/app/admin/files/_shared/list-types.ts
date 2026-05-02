// Shared types/constants for the bulk-delete server actions across
// every files scope (finds, crops, maps). Lives in `_shared` (private
// folder via the leading underscore — Next.js doesn't route under it)
// so the value-side exports are reachable from both server actions
// and client components without "use server" cross-contamination.

/** Hard cap on a single bulk delete submit. Protects against an
 *  accidental click after Select-All on a 17k-entry listing. The
 *  client should chunk if it ever wants to exceed this. */
export const MAX_BULK_DELETE_PER_REQUEST = 100;

export interface BulkDeleteResult {
  /** On-disk filename when resolution succeeded; the raw form the
   *  client sent otherwise (so the user can correlate failures back
   *  to the row they ticked). */
  filename: string;
  status: "ok" | "rejected";
  /** Present on rejections — short Czech reason. */
  reason?: string;
}

/** Result row of a generic bulk-rename action — currently only used
 *  by the "mark map as nonexistent" workflow, but the shape stays
 *  scope-agnostic so a future rename flow can reuse the same UX. */
export interface BulkRenameResult {
  filename: string;
  status: "ok" | "rejected";
  /** New on-disk name on success. */
  to?: string;
  reason?: string;
}
