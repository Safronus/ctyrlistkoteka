// Bulk-delete constants/types for the crops scope. Identical shape
// to the maps variant (see maps/delete-types.ts) but lives here so
// the "use server" delete-action can import the value side without
// breaking the only-async-functions rule for server modules.

export const MAX_BULK_DELETE_PER_REQUEST = 100;

export interface BulkDeleteResult {
  filename: string;
  status: "ok" | "rejected";
  reason?: string;
}
