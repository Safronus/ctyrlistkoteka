import { getLocale, getTranslations } from "next-intl/server";
import { FindState } from "@prisma/client";
import { Camera, Images, MapPin, Trophy } from "lucide-react";
import { Link } from "@/i18n/navigation";
import type { PublicFind } from "@/lib/queries/finds";
import { FindThumbnail } from "./find-thumbnail";
import { StateBadges } from "./state-badges";
import { VoteButton } from "./vote-button";
import {
  formatDateTimeCs,
  formatDistance,
  formatLocationId,
  formatTinyDateTimeCs,
  locationOffsetToneClass,
  mapThumbUrl,
} from "@/lib/format";
import { formatGpsApple } from "@/lib/gpsFormat";

type RowT = Awaited<ReturnType<typeof getTranslations<"FindRow">>>;
type OffsetT = Awaited<ReturnType<typeof getTranslations<"LocationOffset">>>;

export async function FindList({
  finds,
  votedSet,
  voteCounts,
}: {
  finds: readonly PublicFind[];
  /** Set of find IDs this visitor has already voted for — server
   *  pre-resolved via cookie UUID + IP/UA fingerprint so the rendered
   *  thumbs show the correct filled state without a client flash. */
  votedSet?: ReadonlySet<number>;
  /** Per-find vote counts. Map keyed by find ID; missing → 0. */
  voteCounts?: ReadonlyMap<number, number>;
}) {
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
      {finds.map((find, i) => (
        <li key={find.id}>
          <FindListRow
            find={find}
            locale={locale}
            tRow={tRow}
            tOffset={tOffset}
            voted={votedSet?.has(find.id) ?? false}
            voteCount={voteCounts?.get(find.id) ?? 0}
            // First rows are above the fold — eager-load their thumbnails
            // so the LCP image isn't lazy.
            priority={i < 3}
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
  voted,
  voteCount,
  priority = false,
}: {
  find: PublicFind;
  locale: string;
  tRow: RowT;
  tOffset: OffsetT;
  voted: boolean;
  voteCount: number;
  priority?: boolean;
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

  // Red-zone finds (outside every location-map bbox) win over the
  // polygon/centre labels — what matters most is "this find sits
  // outside the location's mapped area", with the distance to the
  // nearest map edge as the actionable number. Yellow + green keep
  // the existing AOI / centre framing.
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
  const offsetTitle = find.locationOffset
    ? offsetOutsideMap !== null
      ? tOffset("outsideMapTitle")
      : find.locationOffset.mode === "polygon"
        ? tOffset("polygonTitle")
        : tOffset("centerTitle")
    : "";

  return (
    <div className="group flex items-stretch transition hover:bg-brand-50">
      <Link
        href={`/sbirka/${find.id}`}
        className="flex min-w-0 flex-1 items-stretch gap-4 p-3"
      >
        {/* `self-end` pins the thumbnail's bottom edge to the row
         *  bottom — same level as the vote button and the right-side
         *  state badges (which sit at column bottom via `mt-auto` +
         *  `items-end`). When the content column grows past 112 px
         *  (long location title + a multi-line note) the empty
         *  space appears ABOVE the thumb instead of straddling top
         *  and bottom; everything in the row reads off a single
         *  bottom baseline. Mirrored on the location-map thumbnail
         *  on the far right. The relative wrapper hosts the record
         *  badge overlay — in list view the badge would crowd the
         *  note out of row 1, so it rides the photo instead. */}
        <div className="relative shrink-0 self-end">
          {/* LOST finds render their photo in grayscale — the quiet
              list-level echo of the detail page's elegy treatment. */}
          <FindThumbnail
            image={find.primaryImage}
            alt={altText}
            priority={priority}
            className={`h-24 w-24 rounded-md sm:h-28 sm:w-28 ${
              find.states.includes(FindState.LOST) ? "grayscale" : ""
            }`}
          />
          {find.isRecord && (
            <span
              className="absolute left-1 top-1 inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50/95 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 shadow-sm"
              title={tRow("recordBadgeTitle")}
            >
              <Trophy className="h-3 w-3" aria-hidden />
              {tRow("recordBadge")}
            </span>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {/* Row 1 — find-centric line: `#id` + optional find note +
           *  date right. The note stays on ONE line next to the id and
           *  ellipsizes when it doesn't fit (full text in the title
           *  tooltip) — wrapping to a second line made row heights
           *  jump around and pushed the rest of the row down. Date
           *  drops to a short "21. 5. 2026 8:50" on phones; full
           *  weekday + seconds restore from sm:. */}
          <div className="flex items-start gap-x-3">
            <div className="flex min-w-0 flex-1 items-baseline gap-x-2">
              <span className="shrink-0 text-base font-semibold text-brand-700 group-hover:underline">
                #{find.id}
              </span>
              {find.notes && (
                <span
                  className="min-w-0 flex-1 truncate text-sm text-gray-700"
                  title={find.notes}
                >
                  {find.notes}
                </span>
              )}
            </div>
            <span className="shrink-0 whitespace-nowrap text-xs text-gray-500">
              <span className="sm:hidden">
                {formatTinyDateTimeCs(find.foundAt, locale)}
              </span>
              <span className="hidden sm:inline">
                {formatDateTimeCs(find.foundAt, locale)}
              </span>
            </span>
          </div>

          {/* Row 2 — geographic line: GPS + offset to its location +
           *  great-circle distance to default map #00001. Each unit
           *  is wrapped in its own `whitespace-nowrap` span so the
           *  break only ever happens at " · " on narrow viewports,
           *  never inside a phrase like "uvnitř AOI". */}
          {!find.isAnonymized && find.coordinates && (
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

          {/* Row 3 — location-centric line: map id + code + (cleaned)
           *  description. Anonymized finds collapse this to a single
           *  placeholder. The description is rendered without the
           *  wrapping parens it carries in the source JSON — the
           *  visual grouping was redundant once the description sits
           *  on its own row. */}
          {find.isAnonymized ? (
            <p className="text-sm text-gray-500">{tRow("anonymizedLocation")}</p>
          ) : find.location ? (
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
              <span className="shrink-0 font-mono text-xs text-gray-500">
                {formatLocationId(find.location.id)}
              </span>
              <span className="shrink-0 text-gray-400">–</span>
              <span
                className="truncate text-gray-800"
                title={find.location.code}
              >
                {find.location.code}
              </span>
              {(() => {
                const cleaned = stripOuterParens(find.location.displayName);
                if (!cleaned || cleaned === find.location.code) return null;
                return (
                  <span
                    className="truncate text-gray-500"
                    title={cleaned}
                  >
                    {cleaned}
                  </span>
                );
              })()}
            </div>
          ) : (
            <p className="text-sm text-gray-500">{tRow("noLocation")}</p>
          )}

          {/* Bottom row of the content column — pushed against the
           *  photo's bottom edge via `mt-auto`. Layout: vote button on
           *  the LEFT (anchored to the photo it belongs to), state +
           *  donation-photo badges on the RIGHT (ml-auto pushes them
           *  out). When either side is empty, the other side takes
           *  the row alone — `flex-wrap` keeps badges from clipping
           *  on narrow mobile rows. */}
          {(find.primaryImage ||
            find.states.length > 0 ||
            find.hasRealPhoto ||
            find.hasFreePhoto) && (
            <div className="mt-auto flex flex-wrap items-end gap-2">
              {find.primaryImage && (
                <VoteButton
                  findId={find.id}
                  initialVoted={voted}
                  initialCount={voteCount}
                  size="lg"
                />
              )}
              {(find.states.length > 0 ||
                find.hasRealPhoto ||
                find.hasFreePhoto) && (
                <div className="ml-auto flex flex-wrap items-center gap-1.5">
                  {find.hasRealPhoto && (
                    // Camera badge — same chip as the /lokality list,
                    // kept in its own pill so it reads as "the find has
                    // extra material" rather than as another state
                    // badge.
                    <span
                      className="inline-flex items-center rounded-md bg-emerald-100 px-1 py-0.5 text-emerald-800"
                      title={tRow("donationPhotoTitle")}
                      aria-label={tRow("donationPhotoTitle")}
                    >
                      <Camera className="h-3 w-3" aria-hidden />
                    </span>
                  )}
                  {find.hasFreePhoto && (
                    <span
                      className="inline-flex items-center rounded-md bg-sky-100 px-1 py-0.5 text-sky-800"
                      title={tRow("freePhotoTitle")}
                      aria-label={tRow("freePhotoTitle")}
                    >
                      <Images className="h-3 w-3" aria-hidden />
                    </span>
                  )}
                  {find.states.length > 0 && (
                    <StateBadges states={find.states} />
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Location map thumbnail — kept off small screens to preserve
         *  room for the title text. Anonymized finds show the generic
         *  placeholder map (#00001) here, same as the detail page, so
         *  the row doesn't have a conspicuous empty slot (the query
         *  fills `locationThumbUrl` accordingly). `self-end` mirrors the
         *  find thumbnail on the left, pinning the map's bottom edge to
         *  the row bottom so it lines up with the state-badge / photo-
         *  icon cluster (which sits at column bottom via `mt-auto` +
         *  `items-end`). Together the two thumbs + the bottom-row chips
         *  read off one shared bottom baseline. */}
        {find.locationThumbUrl && (
          <div className="relative hidden shrink-0 self-end overflow-hidden rounded-md sm:block">
            {/* Served by Nginx; Next Image optimizer not needed. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={mapThumbUrl(find.locationThumbUrl)}
              alt=""
              aria-hidden
              loading="lazy"
              decoding="async"
              className="h-24 w-24 rounded-md border border-gray-200 object-cover sm:h-28 sm:w-28"
            />
            {/* Anonymized finds show the generic placeholder map under a
                blurred "?" curtain — the same "location hidden" treatment
                as the detail page, scaled to the thumbnail. */}
            {find.isAnonymized && (
              <div
                role="img"
                aria-label={tRow("anonymizedLocation")}
                className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-md bg-purple-950/45 backdrop-blur-md"
              >
                <span
                  aria-hidden
                  className="select-none text-3xl font-black leading-none text-purple-50 drop-shadow-[0_2px_6px_rgba(0,0,0,0.5)]"
                >
                  ?
                </span>
                <span className="select-none rounded-full bg-purple-50/90 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-purple-900">
                  {tRow("anonMapBadge")}
                </span>
              </div>
            )}
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

/** Strips a single pair of wrapping parens from a location's display
 *  description so it can sit on its own row without the visual
 *  grouping marks it inherits from the source JSON. Only the outer
 *  pair is touched; nested parens (e.g. "Vedle pomníku Rotary
 *  International (200 m od Ground Zero)") survive intact. Returns
 *  null for null / undefined input. */
function stripOuterParens(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    trimmed.startsWith("(") &&
    trimmed.endsWith(")")
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}
