import { getLocale, getTranslations } from "next-intl/server";
import { Camera, MapPin } from "lucide-react";
import { Link } from "@/i18n/navigation";
import type { PublicFind } from "@/lib/queries/finds";
import { FindThumbnail } from "./find-thumbnail";
import { StateBadges } from "./state-badges";
import {
  formatDateTimeCs,
  formatDistance,
  formatLocationId,
  locationOffsetToneClass,
} from "@/lib/format";
import { formatGpsApple } from "@/lib/gpsFormat";

type RowT = Awaited<ReturnType<typeof getTranslations<"FindRow">>>;
type OffsetT = Awaited<ReturnType<typeof getTranslations<"LocationOffset">>>;

export async function FindList({ finds }: { finds: readonly PublicFind[] }) {
  if (finds.length === 0) {
    const tSbirka = await getTranslations("Sbirka");
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-12 text-center">
        <p className="text-gray-500">{tSbirka("noFindsMatch")}</p>
      </div>
    );
  }

  const [locale, tRow, tOffset] = await Promise.all([
    getLocale(),
    getTranslations("FindRow"),
    getTranslations("LocationOffset"),
  ]);

  return (
    <ul className="divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200 bg-white">
      {finds.map((find) => (
        <li key={find.id}>
          <FindListRow
            find={find}
            locale={locale}
            tRow={tRow}
            tOffset={tOffset}
          />
        </li>
      ))}
    </ul>
  );
}

function FindListRow({
  find,
  locale,
  tRow,
  tOffset,
}: {
  find: PublicFind;
  locale: string;
  tRow: RowT;
  tOffset: OffsetT;
}) {
  // Anonymized finds must not leak their actual location id, code, or
  // description here — mirrors the detail page's substitution. Coords
  // and notes are already stripped upstream by anonymize().
  const altText = find.isAnonymized
    ? tRow("anonymizedAlt", { id: find.id })
    : tRow("findAlt", { id: find.id });

  // The map deep-link only makes sense when the find has a public GPS
  // point to focus on. Anonymized finds expose at most coarsened coords
  // — pinning them precisely on the map would defeat anonymization.
  const showMapLink = !find.isAnonymized && find.coordinates !== null;

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
    <div className="group flex items-stretch transition hover:bg-brand-50">
      <Link
        href={`/sbirka/${find.id}`}
        className="flex min-w-0 flex-1 items-stretch gap-4 p-3"
      >
        <FindThumbnail
          image={find.primaryImage}
          alt={altText}
          className="h-24 w-24 shrink-0 rounded-md sm:h-28 sm:w-28"
        />

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {/* Title row: #ID + #LocId - CODE (description), datetime right. */}
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <FindTitle find={find} tRow={tRow} />
            <span className="shrink-0 text-xs text-gray-500">
              {formatDateTimeCs(find.foundAt, locale)}
            </span>
          </div>

          {!find.isAnonymized && find.coordinates && (
            // Each unit ("GPS pair", "uvnitř AOI", "75,8 km od mapy
            // #00001") sits in its own whitespace-nowrap span so the
            // line breaks only at the " · " separator on narrow mobile
            // viewports, never inside a phrase like "uvnitř AOI".
            <p className="font-mono text-xs text-gray-500">
              <span className="whitespace-nowrap">
                {formatGpsApple(find.coordinates.lat, find.coordinates.lng)}
              </span>
              {find.locationOffset && offsetLabel && (
                <>
                  {" · "}
                  <span
                    className={`whitespace-nowrap ${locationOffsetToneClass(find.locationOffset)}`}
                    title={offsetTitle}
                  >
                    {offsetLabel}
                  </span>
                </>
              )}
              {find.distanceFromDefault !== null && (
                <>
                  {" · "}
                  <span
                    className="whitespace-nowrap text-gray-600"
                    title={tOffset("fromDefaultMapTitle")}
                  >
                    {tOffset("fromDefaultMap", {
                      distance: formatDistance(
                        find.distanceFromDefault,
                        locale,
                      ),
                    })}
                  </span>
                </>
              )}
            </p>
          )}

          {find.notes && (
            <p className="line-clamp-2 text-sm text-gray-600">{find.notes}</p>
          )}

          {(find.states.length > 0 || find.hasRealPhoto) && (
            <div className="mt-auto flex flex-wrap items-center justify-end gap-1.5 self-end">
              {find.hasRealPhoto && (
                // Camera badge — same chip as the /lokality list, kept in
                // its own pill so it reads as "the find has extra
                // material" rather than as another state badge.
                <span
                  className="inline-flex items-center rounded-md bg-emerald-100 px-1 py-0.5 text-emerald-800"
                  title={tRow("donationPhotoTitle")}
                  aria-label={tRow("donationPhotoTitle")}
                >
                  <Camera className="h-3 w-3" aria-hidden />
                </span>
              )}
              {find.states.length > 0 && <StateBadges states={find.states} />}
            </div>
          )}
        </div>

        {/* Location map thumbnail — kept off small screens to preserve room
         *  for the title text. Hidden entirely for anonymized finds. */}
        {find.locationThumbUrl && (
          <div className="hidden shrink-0 sm:block">
            {/* Served by Nginx; Next Image optimizer not needed. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={find.locationThumbUrl}
              alt=""
              aria-hidden
              loading="lazy"
              decoding="async"
              className="h-24 w-24 rounded-md border border-gray-200 object-cover sm:h-28 sm:w-28"
            />
          </div>
        )}
      </Link>

      {showMapLink && (
        <Link
          href={`/mapa?find=${find.id}`}
          className="flex shrink-0 items-center justify-center border-l border-gray-100 px-3 text-gray-400 transition hover:bg-brand-100 hover:text-brand-700 focus:bg-brand-100 focus:text-brand-700 focus:outline-none"
          aria-label={tRow("showOnMap")}
          title={tRow("showOnMap")}
        >
          <MapPin className="h-5 w-5" aria-hidden />
        </Link>
      )}
    </div>
  );
}

function FindTitle({ find, tRow }: { find: PublicFind; tRow: RowT }) {
  if (find.isAnonymized) {
    return (
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-base font-semibold text-brand-700 group-hover:underline">
          #{find.id}
        </span>
        <span className="truncate text-sm text-gray-700">
          {tRow("anonymizedLocation")}
        </span>
      </div>
    );
  }

  const loc = find.location;
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="text-base font-semibold text-brand-700 group-hover:underline">
        #{find.id}
      </span>
      {loc ? (
        <>
          <span className="font-mono text-xs text-gray-500">
            {formatLocationId(loc.id)}
          </span>
          <span className="text-gray-400">–</span>
          <span className="truncate text-sm text-gray-800" title={loc.code}>
            {loc.code}
          </span>
          {loc.displayName && loc.displayName !== loc.code && (
            <span
              className="truncate text-sm text-gray-500"
              title={loc.displayName}
            >
              ({loc.displayName})
            </span>
          )}
        </>
      ) : (
        <span className="text-sm text-gray-700">{tRow("noLocation")}</span>
      )}
    </div>
  );
}
