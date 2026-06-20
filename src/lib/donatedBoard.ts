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

/**
 * Lowest find id that can appear on the board. The apology's "send me a
 * message and I'll mail you a clover" offer only went live around this
 * find, so anything earlier could not have been donated *through that
 * offer*. The /admin candidate list is scoped to ids >= this value.
 */
export const DONATED_BOARD_MIN_FIND_ID = 22094;
