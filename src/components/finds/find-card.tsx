import { getLocale, getTranslations } from "next-intl/server";
import { Camera } from "lucide-react";
import { Link } from "@/i18n/navigation";
import type { PublicFind } from "@/lib/queries/finds";
import { FindThumbnail } from "./find-thumbnail";
import { StateBadges } from "./state-badges";
import {
  formatDistance,
  formatLocationId,
  formatShortDateTimeCs,
  locationOffsetToneClass,
} from "@/lib/format";
import { formatGpsApple } from "@/lib/gpsFormat";

export async function FindCard({ find }: { find: PublicFind }) {
  const locale = await getLocale();
  const tRow = await getTranslations("FindRow");
  const tOffset = await getTranslations("LocationOffset");

  const altText = find.isAnonymized
    ? tRow("anonymizedAlt", { id: find.id })
    : tRow("findAlt", { id: find.id });

  const offsetLabel = find.locationOffset
    ? find.locationOffset.mode === "polygon"
      ? find.locationOffset.inside
        ? tOffset("inside")
        : tOffset("polygonEdge", {
            distance: formatDistance(find.locationOffset.meters, locale),
          })
      : tOffset("mapCenter", {
          distance: formatDistance(find.locationOffset.meters, locale),
        })
    : null;
  const offsetTitle = find.locationOffset
    ? find.locationOffset.mode === "polygon"
      ? tOffset("polygonTitle")
      : tOffset("centerTitle")
    : "";

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
        {find.hasRealPhoto && (
          // Camera-only chip — same look as the /lokality list. Bottom-
          // right corner so it doesn't fight with the state badges that
          // anchor at the top.
          <span
            className="pointer-events-none absolute bottom-2 right-2 inline-flex items-center rounded-md bg-emerald-100 px-1 py-0.5 text-emerald-800 drop-shadow-sm"
            title={tRow("donationPhotoTitle")}
            aria-label={tRow("donationPhotoTitle")}
          >
            <Camera className="h-3 w-3" aria-hidden />
          </span>
        )}
      </div>

      <div className="space-y-1 p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
          <p className="font-semibold text-gray-900 group-hover:text-brand-700">
            #{find.id}
          </p>
          <p className="text-xs text-gray-500">
            {formatShortDateTimeCs(find.foundAt, locale)}
          </p>
        </div>

        {!find.isAnonymized && find.coordinates && (
          <p className="truncate font-mono text-xs text-gray-500">
            {formatGpsApple(find.coordinates.lat, find.coordinates.lng)}
          </p>
        )}
        {!find.isAnonymized && find.locationOffset && offsetLabel && (
          <p
            className={`truncate text-xs ${locationOffsetToneClass(find.locationOffset)}`}
            title={offsetTitle}
          >
            {offsetLabel}
          </p>
        )}
        {!find.isAnonymized && find.distanceFromDefault !== null && (
          <p
            className="truncate text-xs text-gray-500"
            title={tOffset("fromDefaultMapTitle")}
          >
            {tOffset("fromDefaultMap", {
              distance: formatDistance(find.distanceFromDefault, locale),
            })}
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
