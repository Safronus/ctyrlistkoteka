import { z } from "zod";

/**
 * "Kdo už využil nabídky" board — the list of find ids that were donated
 * as a result of the closing apology's offer on the home page. Stored as
 * a plain ordered list of find ids; only finds carrying the DONATED state
 * may be added (enforced by the admin action). Client-safe: schema only;
 * the filesystem read/write lives in donatedBoard.server.ts.
 */

export const donatedBoardSchema = z.array(z.number().int().positive());
export type DonatedBoard = z.infer<typeof donatedBoardSchema>;
