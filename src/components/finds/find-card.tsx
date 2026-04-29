import Link from "next/link";
import type { PublicFind } from "@/lib/queries/finds";
import { FindThumbnail } from "./find-thumbnail";
import { StateBadges } from "./state-badges";
import {
  formatDistance,
  formatLocationId,
  formatLocationOffset,
  formatShortDateTimeCs,
} from "@/lib/format";
import { formatGpsApple } from "@/lib/gpsFormat";

export function FindCard({ find }: { find: PublicFind }) {
  const altText = find.isAnonymized
    ? `Anonymizovaný nález #${find.id}`
    : `Nález #${find.id}`;

  return (
    <Link
      href={`/sbirka/${find.id}`}
      className="group block overflow-hidden rounded-lg border border-gray-200 bg-white transition hover:border-brand-200 hover:shadow-sm"
    >
      <div className="relative">
        <FindThumbnail
          image={find.primaryImage}
          alt={altText}
          className="aspect-square"
        />
        {/* State badges overlaid on the photo so the descriptor row below
            stays clean. Each badge keeps its own background color from
            STATE_BADGE, plus a soft shadow for legibility on busy photos. */}
        {find.states.length > 0 && (
          <div className="pointer-events-none absolute inset-x-2 top-2">
            <StateBadges states={find.states} className="drop-shadow-sm" />
          </div>
        )}
      </div>

      <div className="space-y-1 p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
          <p className="font-semibold text-gray-900 group-hover:text-brand-700">
            #{find.id}
          </p>
          <p className="text-xs text-gray-500">
            {formatShortDateTimeCs(find.foundAt)}
          </p>
        </div>

        {!find.isAnonymized && find.coordinates && (
          <p className="truncate font-mono text-xs text-gray-500">
            {formatGpsApple(find.coordinates.lat, find.coordinates.lng)}
          </p>
        )}
        {!find.isAnonymized && find.locationOffset && (
          <p
            className="truncate text-xs text-gray-500"
            title={
              find.locationOffset.mode === "polygon"
                ? "Vzdušná vzdálenost od hrany polygonu lokace (0 = uvnitř AOI)"
                : "Vzdušná vzdálenost od GPS středu lokační mapy"
            }
          >
            {formatLocationOffset(find.locationOffset)}
          </p>
        )}
        {!find.isAnonymized && find.distanceFromDefault !== null && (
          <p
            className="truncate text-xs text-gray-500"
            title="Vzdušná vzdálenost od GPS středu lokační mapy 00001"
          >
            {formatDistance(find.distanceFromDefault)} od MAP 00001
          </p>
        )}

        {find.isAnonymized ? (
          <p className="truncate text-xs text-gray-500">
            Anonymizovaná lokalita
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
          <p className="text-xs text-gray-500">Bez lokality</p>
        )}
      </div>
    </Link>
  );
}
