import { getLocale, getTranslations } from "next-intl/server";
import { FindState } from "@prisma/client";
import { Camera, Images, Trophy } from "lucide-react";
import { Link } from "@/i18n/navigation";
import type { PublicFind } from "@/lib/queries/finds";
import { FindThumbnail } from "./find-thumbnail";
import { StateBadges } from "./state-badges";
import { VoteButton } from "./vote-button";
import {
  formatDistance,
  formatLocationId,
  formatShortDateTimeCs,
  locationOffsetDotClass,
} from "@/lib/format";
import { formatGpsApple } from "@/lib/gpsFormat";

export async function FindCard({
  find,
  voted,
  voteCount,
  priority = false,
}: {
  find: PublicFind;
  voted: boolean;
  voteCount: number;
  /** Eager-load this card's thumbnail (first grid row) to fix the LCP. */
  priority?: boolean;
}) {
  const locale = await getLocale();
  const tRow = await getTranslations("FindRow");
  const tOffset = await getTranslations("LocationOffset");

  const altText = find.isAnonymized
    ? tRow("anonymizedAlt", { id: find.id })
    : tRow("findAlt", { id: find.id });

  // Red-zone finds (outside every location-map bbox) show distance
  // to the nearest map edge instead of AOI / centre offset — what
  // matters most is "this find sits outside the location's mapped
  // area". See find-list.tsx for the parallel logic.
  const offsetOutsideMap =
    find.locationOffset &&
    !find.locationOffset.withinMap &&
    find.locationOffset.metersOutsideMap !== null
      ? find.locationOffset.metersOutsideMap
      : null;
  const offsetLabel = find.locationOffset
    ? offsetOutsideMap !== null
      ? tOffset("outsideMap", {
          distance: formatDistance(offsetOutsideMap, locale),
        })
      : find.locationOffset.mode === "polygon"
        ? find.locationOffset.inside
          ? tOffset("inside")
          : tOffset("polygonEdge", {
              distance: formatDistance(find.locationOffset.meters, locale),
            })
        : tOffset("mapCenter", {
            distance: formatDistance(find.locationOffset.meters, locale),
          })
    : null;
  return (
    <Link
      href={`/sbirka/${find.id}`}
      className="group block overflow-hidden rounded-lg border border-gray-200 bg-white transition hover:border-brand-200 hover:shadow-sm"
    >
      <div className="relative">
        {/* LOST finds render their photo in grayscale — the quiet
            list-level echo of the detail page's elegy treatment. The
            overlaid badges/vote button are siblings, so they keep
            their colors. */}
        <FindThumbnail
          image={find.primaryImage}
          alt={altText}
          priority={priority}
          className={`aspect-square ${
            find.states.includes(FindState.LOST) ? "grayscale" : ""
          }`}
        />
        {/* State badges overlaid on the photo so the descriptor row below
            stays clean. Each badge keeps its own background color from
            STATE_BADGE, plus a soft shadow for legibility on busy photos. */}
        {find.states.length > 0 && (
          <div className="pointer-events-none absolute inset-x-2 top-2">
            <StateBadges states={find.states} className="drop-shadow-sm" />
          </div>
        )}
        {(find.hasRealPhoto || find.hasFreePhoto) && (
          // Stack the gallery chips bottom-right. Camera (donation)
          // first when present, then Images (free) — same emerald hue
          // for hasRealPhoto, sky for hasFreePhoto so the two are
          // visually distinct without screaming.
          <div className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-1">
            {find.hasRealPhoto && (
              <span
                className="inline-flex items-center rounded-md bg-emerald-100 px-1 py-0.5 text-emerald-800 drop-shadow-sm"
                title={tRow("donationPhotoTitle")}
                aria-label={tRow("donationPhotoTitle")}
              >
                <Camera className="h-3 w-3" aria-hidden />
              </span>
            )}
            {find.hasFreePhoto && (
              <span
                className="inline-flex items-center rounded-md bg-sky-100 px-1 py-0.5 text-sky-800 drop-shadow-sm"
                title={tRow("freePhotoTitle")}
                aria-label={tRow("freePhotoTitle")}
              >
                <Images className="h-3 w-3" aria-hidden />
              </span>
            )}
          </div>
        )}
        {/* Vote button overlay — bottom-left corner so it stays clear
         *  of state badges (top) and the camera chip (bottom-right).
         *  Compact mode hides the count inline (it'd crowd the corner)
         *  and surfaces it via the aria-label only. We render only
         *  when a thumbnail exists — no-photo finds have nothing to
         *  vote on per the design discussion. */}
        {find.primaryImage && (
          <div className="absolute bottom-2 left-2 rounded-full bg-white/90 backdrop-blur-sm drop-shadow-sm">
            <VoteButton
              findId={find.id}
              initialVoted={voted}
              initialCount={voteCount}
              size="md"
            />
          </div>
        )}
      </div>

      <div className="space-y-1 p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
          <div className="flex items-center gap-1.5">
            <p className="font-semibold text-gray-900 group-hover:text-brand-700">
              #{find.id}
            </p>
            {find.isRecord && (
              <span
                className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700"
                title={tRow("recordBadgeTitle")}
              >
                <Trophy className="h-3 w-3" aria-hidden />
                {tRow("recordBadge")}
              </span>
            )}
          </div>
          {/* Date + location-offset indicator dot, top-right. The dot
              replaces the old "uvnitř AOI / X od středu" text line — its
              colour graduates green→amber→rose by how far the find sits
              from its location, with the detail in the tooltip. */}
          <span className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500">
              {formatShortDateTimeCs(find.foundAt, locale)}
            </span>
            {!find.isAnonymized && find.locationOffset && offsetLabel && (
              <span
                role="img"
                aria-label={offsetLabel}
                title={offsetLabel}
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${locationOffsetDotClass(find.locationOffset)}`}
              />
            )}
          </span>
        </div>

        {!find.isAnonymized && find.coordinates && (
          <p className="truncate font-mono text-xs text-gray-500">
            {formatGpsApple(find.coordinates.lat, find.coordinates.lng, locale)}
          </p>
        )}

        {find.isAnonymized ? (
          <p className="truncate text-xs text-gray-500">
            {tRow("anonymizedLocation")}
          </p>
        ) : find.location ? (
          <p
            className="truncate text-xs text-gray-600"
            title={find.location.code}
          >
            {find.location.code}{" "}
            <span className="font-mono text-gray-500">
              {formatLocationId(find.location.id)}
            </span>
          </p>
        ) : (
          <p className="text-xs text-gray-500">{tRow("noLocation")}</p>
        )}
      </div>
    </Link>
  );
}
