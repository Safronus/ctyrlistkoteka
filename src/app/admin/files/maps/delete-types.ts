// Constants and types for the bulk delete server action. Lives next
// to delete-action.ts because "use server" modules may only export
// async functions; the rule that gave us this split is recorded in
// MEMORY/feedback_use_server_only_async.md.

/** Hard cap on a single bulk delete submit. The UI is a checkbox
 *  list so the user can in theory select every entry on a page, but
 *  100 is plenty for the realistic "clean up duplicates" workflow
 *  and stops a runaway request from trashing the whole maps tree
 *  in one go. */
export const MAX_BULK_DELETE_PER_REQUEST = 100;

export interface BulkDeleteResult {
  /** On-disk filename when the resolution succeeded; the raw form
   *  the client sent otherwise (so the user can correlate failures
   *  back to the row they ticked). */
  filename: string;
  status: "ok" | "rejected";
  /** Present on rejections — short Czech reason for the failure. */
  reason?: string;
}
