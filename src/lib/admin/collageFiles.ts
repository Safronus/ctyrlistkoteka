import { stat } from "node:fs/promises";
import path from "node:path";
import { GENERATED_ROOT } from "./paths";
import {
  COLLAGE_VARIANTS,
  collageUrl,
  type CollageVariant,
} from "@/lib/collage";

/** One generated collage as the admin needs to show it. */
export interface CollageFile {
  variant: CollageVariant;
  /** Public URL — Nginx serves `/generated/` straight off the disk. */
  url: string;
  /** False when `pnpm collage` hasn't produced this one yet. */
  exists: boolean;
  bytes: number;
  /** ISO, so the admin can say how old the picture is. */
  builtAt: string | null;
}

/**
 * What the collage directory actually holds.
 *
 * Read from disk rather than assumed: the collages are built by hand on
 * the server, so "which ones exist" is genuinely unknown to the app, and
 * a download link to a file that was never generated is a 404 the
 * operator has to interpret. Six `stat` calls on an already-dynamic page.
 */
export async function listCollageFiles(): Promise<CollageFile[]> {
  return await Promise.all(
    COLLAGE_VARIANTS.map(async (variant) => {
      const file = path.join(
        GENERATED_ROOT,
        "collage",
        `${variant.toLowerCase()}.webp`,
      );
      try {
        const s = await stat(file);
        return {
          variant,
          url: collageUrl(variant),
          exists: true,
          bytes: s.size,
          builtAt: s.mtime.toISOString(),
        };
      } catch {
        return {
          variant,
          url: collageUrl(variant),
          exists: false,
          bytes: 0,
          builtAt: null,
        };
      }
    }),
  );
}
