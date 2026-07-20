/**
 * Random find showcase. Backs the home page's "Náhodný nález" widget
 * and the `/api/random-find` endpoint that the widget polls every
 * minute. Anonymized finds are intentionally included — the photo +
 * detail link are public, and the find detail page already redacts
 * private fields per CLAUDE.md §6.
 */

import type { FindState } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import type { PublicImage } from "./finds";

export interface RandomFindShowcase {
  id: number;
  isAnonymized: boolean;
  foundAt: string | null;
  /** Null when the find is anonymized — code/displayName must not leak. */
  location: { id: number; code: string; displayName: string } | null;
  /** ORIGINAL image (the full photo). The widget hands this to
   *  `ImageGallery` as the base layer. */
  primaryImage: PublicImage | null;
  /** CROP image (the magnified leaf cut-out). `ImageGallery` cross-fades
   *  to this when the lupa button is hovered. The query filters to
   *  finds that have *both* images, so this is non-null in practice. */
  cropImage: PublicImage | null;
  /** True when the find has a recorded GPS point AND is public — gates
   *  the "show on map" deep-link button. We don't ship the actual lat/lng
   *  here (the showcase doesn't display them anywhere); the map page
   *  resolves them itself from `?find=<id>`. */
  hasMapPosition: boolean;
  /** Denormalized public vote count for the find. Same column that
   *  drives the /sbirka list rows + Top 10 leaderboard, so it's
   *  always cheap to ship along with the showcase payload. The
   *  per-visitor "did I vote?" flag is fetched separately by the
   *  client (GET /api/finds/<id>/vote) because including it here
   *  would force the random-find endpoint to be visitor-specific. */
  voteCount: number;
  /** Public states (LOST, DONATED, GIGANT, ANONYMIZED, …) for the badge
   *  overlay on the photo. Retired states are filtered out at render time
   *  by `StateBadges`. */
  states: FindState[];
}

export async function getRandomFindShowcase(): Promise<RandomFindShowcase | null> {
  // Pick a random ID first so the heavier `findUnique` only hydrates
  // one row. Filter to finds that have *both* an ORIGINAL and a CROP
  // image — the showcase's headline interaction is the lupa, which
  // needs a crop to swap to. Without this filter the random rotation
  // would occasionally land on a find with a dead button.
  const picked = await prisma.$queryRaw<
    Array<{ id: number; has_gps: boolean; is_anon: boolean }>
  >`
    SELECT
      f.id,
      (f.coordinates IS NOT NULL) AS has_gps,
      f.is_anonymized AS is_anon
    FROM finds f
    WHERE EXISTS (
      SELECT 1 FROM find_images i
      WHERE i.find_id = f.id AND i.image_type = 'ORIGINAL'
    )
    AND EXISTS (
      SELECT 1 FROM find_images i
      WHERE i.find_id = f.id AND i.image_type = 'CROP'
    )
    ORDER BY RANDOM()
    LIMIT 1
  `;
  const row = picked[0];
  if (!row) return null;
  const hasMapPosition = row.has_gps && !row.is_anon;

  const find = await prisma.find.findUnique({
    where: { id: row.id },
    select: {
      id: true,
      foundAt: true,
      isAnonymized: true,
      voteCount: true,
      location: { select: { id: true, code: true, displayName: true } },
      states: { select: { state: true } },
      images: {
        orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }],
        select: {
          id: true,
          imageType: true,
          webPath: true,
          thumbPath: true,
          width: true,
          height: true,
          isPrimary: true,
          sortOrder: true,
        },
      },
    },
  });
  if (!find) return null;

  const primaryImage =
    find.images.find((i) => i.imageType === "ORIGINAL") ?? null;
  const cropImage = find.images.find((i) => i.imageType === "CROP") ?? null;

  return {
    id: find.id,
    foundAt: find.foundAt ? find.foundAt.toISOString() : null,
    isAnonymized: find.isAnonymized,
    location: find.isAnonymized ? null : find.location,
    primaryImage,
    cropImage,
    hasMapPosition,
    voteCount: find.voteCount,
    states: find.states.map((s) => s.state),
  };
}
