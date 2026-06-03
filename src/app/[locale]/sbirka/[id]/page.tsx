import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  MapPin,
} from "lucide-react";
import { FindState, ImageType } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import {
  DetailVibeOverlay,
  isHellishFind,
} from "@/components/finds/detail-vibe-overlay";
import { GpsValue } from "@/components/finds/gps-value";
import { ImageGallery } from "@/components/finds/image-gallery";
import { BackToSbirkaLink } from "@/components/finds/sbirka-back-link";
import { StateBadges } from "@/components/finds/state-badges";
import { VoteButton } from "@/components/finds/vote-button";
import {
  formatDateTimeCs,
  formatDistance,
  formatLocationId,
  locationDetailHref,
  locationOffsetToneClass,
} from "@/lib/format";
import { FIND_DEVIATION_RADIUS_M } from "@/lib/constants";
import { isFormerLocation } from "@/lib/locationCode";
import {
  getAdjacentFindIds,
  getAllFindIds,
  getFindById,
  type PublicLocationMap,
} from "@/lib/queries/finds";
import {
  computeFingerprint,
  getFindVoteCount,
  getVotedFindIds,
  readFingerprintInputs,
  readVoterUuid,
} from "@/lib/votes";

interface PageProps {
  params: Promise<{ id: string; locale: string }>;
}

// Must be a literal for Next.js static analysis. Matches FIND_REVALIDATE in
// src/lib/constants.ts (24 hours).
export const revalidate = 86400;

export async function generateStaticParams() {
  // Pre-render finds that exist at build time; further IDs use ISR.
  const ids = await getAllFindIds();
  return ids.map((id) => ({ id: String(id) }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslations("FindDetail");
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) {
    return { title: t("metaNotFound") };
  }
  const find = await getFindById(numId);
  if (!find) {
    return { title: t("metaNotFound") };
  }
  // Anonymized finds must not be indexed and must not leak data in meta tags.
  if (find.isAnonymized) {
    return {
      title: t("metaAnonymizedTitle", { id: find.id }),
      description: t("metaAnonymizedDescription", { id: find.id }),
      robots: { index: false, follow: false },
    };
  }
  const locationName =
    find.location?.displayName ?? find.location?.code ?? t("fallbackLocation");
  const title = t("metaTitle", { id: find.id, locationName });
  const description = t("metaDescription", { locationName });
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article",
    },
  };
}

export default async function FindDetailPage({ params }: PageProps) {
  const { id, locale } = await params;
  const t = await getTranslations("FindDetail");
  const tOffset = await getTranslations("LocationOffset");
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) notFound();
  const [find, adjacent] = await Promise.all([
    getFindById(numId),
    getAdjacentFindIds(numId),
  ]);
  if (!find) notFound();

  // Each find has at most one main photo (ORIGINAL) and at most one crop
  // (CROP). If imports leave duplicates behind, we still pick a single
  // representative for each — the page never shows multiple variants.
  // Finds tagged NO_PHOTO have no images by definition; force both
  // slots to null so the gallery renders the placeholder instead of
  // a stale crop sneaking through and dragging the lupa with it.
  const isNoPhoto = find.states.includes(FindState.NO_PHOTO);
  const mainImage = isNoPhoto
    ? null
    : (find.images.find((i) => i.imageType === ImageType.ORIGINAL) ??
      find.images[0] ??
      null);
  const cropImage = isNoPhoto
    ? null
    : (find.images.find((i) => i.imageType === ImageType.CROP) ?? null);

  // #111 and #666 get special atmospheric overlays — see CLAUDE.md /
  // detail-vibe-overlay.tsx for the contract. Everything else renders
  // unchanged. The overlay is full-viewport `position: fixed` so it
  // sits on top of the article without affecting layout.
  const hellish = isHellishFind(find.id);

  // Vote state for this find — server reads cookie + fingerprint,
  // checks the vote table. Wrapped in try/catch so the detail page
  // still renders if the operator hasn't set VOTE_FINGERPRINT_SALT.
  let voted = false;
  let voteCount = 0;
  try {
    const [uuid, fpInputs] = await Promise.all([
      readVoterUuid(),
      readFingerprintInputs(),
    ]);
    const fingerprint = computeFingerprint(fpInputs);
    const [votedSet, count] = await Promise.all([
      getVotedFindIds([find.id], uuid, fingerprint),
      getFindVoteCount(find.id),
    ]);
    voted = votedSet.has(find.id);
    voteCount = count;
  } catch {
    voteCount = await getFindVoteCount(find.id);
  }

  // Composite "GPS offset" label for the meta panel: outside every
  // location-map bbox → distance to the nearest map edge; otherwise the
  // AOI polygon-edge / inside / centre wording. Mirrors the /sbirka rows
  // (this used to live inline in the header meta row). Null when the
  // find is anonymized or has no usable offset.
  let offsetInfo: { label: string; title: string; toneClass: string } | null =
    null;
  if (!find.isAnonymized && find.locationOffset) {
    const offset = find.locationOffset;
    const outsideMap =
      !offset.withinMap && offset.metersOutsideMap !== null
        ? offset.metersOutsideMap
        : null;
    const label =
      outsideMap !== null
        ? tOffset("outsideMap", {
            distance: formatDistance(outsideMap, locale),
          })
        : offset.mode === "polygon"
          ? offset.inside
            ? tOffset("inside")
            : tOffset("polygonEdge", {
                distance: formatDistance(offset.meters, locale),
              })
          : tOffset("mapCenter", {
              distance: formatDistance(offset.meters, locale),
            });
    const title =
      outsideMap !== null
        ? tOffset("outsideMapTitle")
        : offset.mode === "polygon"
          ? t("offsetTitlePolygon")
          : t("offsetTitleCenter");
    offsetInfo = { label, title, toneClass: locationOffsetToneClass(offset) };
  }

  const detail = (
    <article className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <nav
        aria-label={t("navAriaLabel")}
        className={`flex flex-wrap items-center justify-between gap-3 text-sm ${
          hellish ? "text-red-300/80" : "text-gray-500"
        }`}
      >
        <BackToSbirkaLink />
        <div className="flex items-center gap-3">
          <AdjacentLink direction="prev" id={adjacent.prevId} hellish={hellish} t={t} />
          <AdjacentLink direction="next" id={adjacent.nextId} hellish={hellish} t={t} />
        </div>
      </nav>

      <header className="space-y-3">
        {/* Title row: ID on the left, state badges (Darovaný, Anonymizovaný,
            …) flush right. Multiple states stack here when a find carries
            more than one — e.g. anonymized + donated. */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h1
            className={`text-3xl font-bold ${
              hellish ? "text-red-100" : "text-gray-900"
            }`}
          >
            {t("h1", { id: find.id })}
          </h1>
          <div className="flex items-center gap-3">
            {find.states.length > 0 && <StateBadges states={find.states} />}
            {/* Public vote button — same rules as on /sbirka rows:
             *  show only when there's a photo to vote on. NO_PHOTO
             *  finds skip the affordance. The button is its own
             *  client island, so cookies + fingerprint resolution
             *  happen inline. */}
            {!isNoPhoto && (
              <VoteButton
                findId={find.id}
                initialVoted={voted}
                initialCount={voteCount}
                size="lg"
              />
            )}
          </div>
        </div>

        {/* Notes are nulled at the query layer for anonymized AND
            donated finds (see hydrate() in src/lib/queries/finds.ts),
            so a single truthy guard here covers every privacy rule —
            no need to re-check states. */}
        {find.notes && (
          <p className="whitespace-pre-wrap rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800">
            {find.notes}
          </p>
        )}
      </header>

      {/* Time & position summary — framed like the Lokalita panel and
          sitting directly under the main heading. Holds the find's
          date/time, GPS, its offset from the location map and the
          great-circle distance from MAP 00001 (this replaces the plain
          header meta row). */}
      <Panel title={t("panelMeta")}>
        <KeyValue
          label={t("metaDate")}
          value={formatDateTimeCs(find.foundAt, locale)}
        />
        {!find.isAnonymized && find.coordinates && (
          <KeyValue
            label={t("metaGps")}
            value={
              <GpsValue
                lat={find.coordinates.lat}
                lng={find.coordinates.lng}
                tone="default"
              />
            }
          />
        )}
        {offsetInfo && (
          <KeyValue
            label={t("metaOffset")}
            value={
              <span
                className={`font-mono tabular-nums ${offsetInfo.toneClass}`}
                title={offsetInfo.title}
              >
                {offsetInfo.label}
              </span>
            }
          />
        )}
        {find.distanceFromDefault !== null && (
          <KeyValue
            label={t("metaDistance")}
            value={
              <span
                className="font-mono tabular-nums text-gray-800"
                title={t("distanceTitle")}
              >
                {formatDistance(find.distanceFromDefault, locale)}
              </span>
            }
          />
        )}
        {/* Photo embedded as the last element of the section, mirroring
            the location map inside the Lokalita panel. pt-2 matches the
            map gallery's separation from the rows above. */}
        <div className="pt-2">
          <ImageGallery
            image={mainImage}
            cropImage={cropImage}
            altBase={t("imageAlt", { id: find.id })}
            findId={find.id}
            donationPhotos={find.donationPhotos}
            freePhotos={find.freePhotos}
          />
        </div>
      </Panel>

      {find.isAnonymized && (
        <p className="rounded-md border border-purple-200 bg-purple-50 p-3 text-sm text-purple-900">
          {t("anonymizedNotice")}
        </p>
      )}

      <Panel
        title={t("panelLocation")}
        rightSlot={
          /* Hide the location-id chip for anonymized finds — the
             id would be the privacy placeholder (#00001) and
             showing it next to the "skutečná lokalita se
             nezobrazuje" notice is contradictory. */
          !find.isAnonymized && find.location && (
            <span className="font-mono text-xs text-gray-500">
              {formatLocationId(find.location.id)}
            </span>
          )
        }
      >
        {find.isAnonymized ? (
          /* Anonymized finds get only the short notice + the
             placeholder map (question-mark watermark) — no
             location code, no displayName, no rank, no prev/next
             nav, no "show on map" link. Everything the panel
             would normally surface is either the privacy
             placeholder (misleading to show) or a real location
             field (an outright leak). */
          <p className="rounded-md border border-purple-200 bg-purple-50 p-3 text-sm text-purple-900">
            {t("anonymizedLocationNotice")}
          </p>
        ) : (
          <>
            {isFormerLocation(find.location?.code) && (
              <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
                {t("formerLocationNotice")}
              </p>
            )}
            {find.location ? (
              <>
                <KeyValue label={t("kvCode")} value={find.location.code} />
                <KeyValue
                  label={t("kvDescription")}
                  value={find.location.displayName}
                />
                {/* "Nth find of M" line — ordering matches the
                    /sbirka "oldest first" sort filtered by the same
                    location, so the visitor can scroll the listing
                    to find the same neighbour. Query layer returns
                    null when the rank can't be computed (no
                    location, or anonymized — but anonymized takes
                    the other branch above anyway). */}
                {find.rankAtLocation && (
                  <KeyValue
                    label={t("kvOrderAtLocation")}
                    value={t("orderAtLocationValue", {
                      rank: find.rankAtLocation.rank,
                      total: find.rankAtLocation.total,
                    })}
                  />
                )}
                {/* Map deep-link + prev/next chips share one row:
                    "Zobrazit na mapě" anchors LEFT, prev/next
                    cluster sits flush RIGHT via `ml-auto`. With
                    flex-wrap the cluster falls below the map link
                    on narrow widths instead of overlapping.
                    Map link only renders for finds with GPS
                    (`?find=N` deep-link drives the highlight +
                    auto-fit on /mapa — anonymized finds never
                    reach this branch).
                    Prev/next cluster only renders when the
                    location has more than one find; each chip
                    stays rendered at the chain boundary as a
                    faded non-interactive span so the row doesn't
                    jump between finds. */}
                {(find.coordinates ||
                  (find.rankAtLocation &&
                    find.rankAtLocation.total > 1)) && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {find.coordinates && (
                      <Link
                        href={`/mapa?find=${find.id}`}
                        className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm"
                      >
                        <MapPin className="h-3.5 w-3.5" aria-hidden />
                        <span>{t("showOnMap")}</span>
                      </Link>
                    )}
                    {find.rankAtLocation &&
                      find.rankAtLocation.total > 1 && (
                        <div className="ml-auto flex flex-wrap items-center gap-2">
                          {/* "1." → first find at location. Stays
                              rendered (disabled) when the visitor
                              IS the first one so the row's button
                              positions don't shift between finds.
                              Mirror for the "Total." chip on the
                              right. */}
                          <LocationExtremeLink
                            targetId={find.rankAtLocation.firstId}
                            label="1."
                            ariaLabel={t("firstAtLocation")}
                            isCurrent={find.rankAtLocation.rank === 1}
                          />
                          <LocationNavLink
                            direction="prev"
                            targetId={find.rankAtLocation.prevId}
                            label={t("prevAtLocation")}
                          />
                          <LocationNavLink
                            direction="next"
                            targetId={find.rankAtLocation.nextId}
                            label={t("nextAtLocation")}
                          />
                          <LocationExtremeLink
                            targetId={find.rankAtLocation.lastId}
                            label={`${find.rankAtLocation.total.toLocaleString(
                              locale === "en" ? "en-GB" : "cs-CZ",
                            )}.`}
                            ariaLabel={t("lastAtLocation")}
                            isCurrent={
                              find.rankAtLocation.rank ===
                              find.rankAtLocation.total
                            }
                          />
                        </div>
                      )}
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-gray-600">{t("noLocation")}</p>
            )}
          </>
        )}
        {find.locationMaps.length > 0 && (
          <LocationMapsGallery
            maps={find.locationMaps}
            locationOffset={find.locationOffset}
            isAnonymized={find.isAnonymized}
            /* locationId is non-null only when the gallery actually
               represents the find's real location — anonymized finds
               render the placeholder location and we don't want the
               overlay to deep-link to that. */
            locationId={
              find.isAnonymized ? null : (find.location?.id ?? null)
            }
            locale={locale}
            t={t}
          />
        )}
      </Panel>
    </article>
  );

  return (
    <>
      <DetailVibeOverlay id={find.id} />
      {hellish ? (
        <div className="min-h-screen bg-gradient-to-br from-gray-950 via-red-950/85 to-black">
          {detail}
        </div>
      ) : (
        detail
      )}
    </>
  );
}

type FindDetailT = (
  key: string,
  values?: Record<string, string | number | Date>,
) => string;

/** Status classes for the per-map indicator banner + halo around the
 *  existing clover pin. Mirrors the colour vocabulary used by
 *  /sbirka's `locationOffsetToneClass` so visitors get a consistent
 *  signal from list → detail. */
type MapStatus = "in_polygon" | "outside_polygon" | "outside_map" | "no_gps";

interface MapStatusStyle {
  /** Tailwind classes for the status banner (background + border + text). */
  banner: string;
  /** Tailwind classes for the leading dot inside the banner. */
  dot: string;
  /** CSS `filter` chain applied to the pin SVG. Colour-tinted glow
   *  layered on top of the existing black drop-shadow so the marker
   *  carries its own contrast against grass/pavement/snow alike. */
  pinFilter: string | null;
}

const MAP_STATUS_STYLES: Record<MapStatus, MapStatusStyle> = {
  in_polygon: {
    banner: "bg-emerald-50 border-emerald-300 text-emerald-900",
    dot: "bg-emerald-500",
    pinFilter:
      "drop-shadow(0 0 8px rgba(16,185,129,0.7)) drop-shadow(0 1px 2px rgba(0,0,0,0.45))",
  },
  outside_polygon: {
    // Amber middle band — the find IS inside the location-map's
    // image bbox (otherwise it would classify as `outside_map`
    // instead) but not inside the AOI polygon / within 5 m of the
    // centre. Mirrors the yellow band in `locationOffsetToneClass`
    // on /sbirka rows.
    banner: "bg-amber-50 border-amber-300 text-amber-900",
    dot: "bg-amber-500",
    pinFilter:
      "drop-shadow(0 0 8px rgba(245,158,11,0.75)) drop-shadow(0 1px 2px rgba(0,0,0,0.45))",
  },
  outside_map: {
    banner: "bg-rose-50 border-rose-300 text-rose-900",
    dot: "bg-rose-500",
    // No pin on-image when the find is outside the bbox.
    pinFilter: null,
  },
  no_gps: {
    banner: "bg-gray-100 border-gray-300 text-gray-700",
    dot: "bg-gray-400",
    pinFilter:
      "drop-shadow(0 0 8px rgba(156,163,175,0.6)) drop-shadow(0 1px 2px rgba(0,0,0,0.3))",
  },
};

/** Determines which status applies for a given map row.
 *
 *  Truth table:
 *   - marker null OR no-gps                → no_gps
 *   - marker outside                       → outside_map
 *   - marker inside + offset says outside-polygon → outside_polygon
 *   - else                                 → in_polygon
 *
 *  `locationOffset` lives on the find (one polygon-membership flag
 *  shared by every map of the find's location), so it can refine the
 *  green/yellow split inside the bbox; for `mode === "center"` it
 *  has no polygon to compare against and we fall back to green. */
function classifyMapStatus(
  marker: PublicLocationMap["marker"],
  offset: { meters: number; mode: "polygon" | "center"; inside: boolean } | null,
): MapStatus {
  if (!marker || marker.kind === "no-gps") return "no_gps";
  if (marker.kind === "outside") return "outside_map";
  if (offset) {
    // Polygon mode: inside flag drives green/red directly.
    // Centre mode (no polygon): apply the same FIND_DEVIATION_RADIUS_M
    // threshold the /sbirka tone class and the /mapa "Skrýt
    // odchýlené" toggle use, so all three surfaces agree.
    if (offset.mode === "polygon" && offset.inside === false) {
      return "outside_polygon";
    }
    if (offset.mode === "center" && offset.meters > FIND_DEVIATION_RADIUS_M) {
      return "outside_polygon";
    }
  }
  return "in_polygon";
}

function LocationMapsGallery({
  maps,
  locationOffset,
  isAnonymized = false,
  locationId,
  locale,
  t,
}: {
  maps: readonly PublicLocationMap[];
  /** Pre-computed offset from the find's location polygon/center.
   *  Drives the green/yellow split inside the bbox; null when the
   *  find is anonymized, has no GPS, or the location has neither a
   *  polygon nor a centre point. */
  locationOffset: {
    meters: number;
    mode: "polygon" | "center";
    inside: boolean;
  } | null;
  /** Anonymized finds get a `?` overlay on the placeholder map so a
   *  visitor can't mistake the substituted default location for the
   *  real one. The query layer already strips the marker (`no-gps`)
   *  and swaps in the placeholder location; this is the visual seal. */
  isAnonymized?: boolean;
  /** The find's actual location id, used by the per-map overlay
   *  chips that link to /lokality/<id> and /mapa?focus=<id>. Null
   *  when the find is anonymized (the gallery shows a placeholder
   *  map and the deep-link would point to the wrong place) OR when
   *  the find has no location at all. */
  locationId: number | null;
  /** Used to format the distance suffix in the status banner. */
  locale: string;
  /** Server-side translator pre-bound to the `FindDetail` namespace.
   *  Passed as a prop instead of re-derived here so the helper stays
   *  a sync function (next-intl's `getTranslations` is async). */
  t: FindDetailT;
}) {
  return (
    <div className="space-y-3 pt-2">
      {maps.map((m) => {
        const status = isAnonymized
          ? null
          : classifyMapStatus(m.marker, locationOffset);
        const style = status ? MAP_STATUS_STYLES[status] : null;
        return (
          <figure
            key={m.id}
            className="overflow-hidden rounded-md border border-gray-200 bg-gray-50"
          >
            {/* Status banner — colored strip above the image so the
                visitor sees the verdict before scanning the map for
                the pin. Anonymized finds skip the banner because the
                marker is stripped server-side anyway; their distinct
                purple overlay handles the messaging. */}
            {status && style && (
              <div
                className={`flex items-center gap-2 border-b px-3 py-1.5 text-xs font-medium ${style.banner}`}
              >
                <span
                  aria-hidden
                  className={`inline-block h-2 w-2 shrink-0 rounded-full ${style.dot}`}
                />
                <span>
                  {statusLabel(status, locationOffset, locale, t)}
                </span>
              </div>
            )}
            {/* Wrapper is `relative` so the find's GPS marker can be
                positioned absolutely on top of the lazy-loaded image. */}
            <div className="relative">
              {/* Served by Nginx, no Next.js optimizer (docs/architecture.md). */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={m.imageUrl}
                alt={m.description ?? t("mapImageFallback")}
                loading="lazy"
                decoding="async"
                className="block h-auto w-full"
              />
              {!isAnonymized && m.marker?.kind === "inside" && style && (
                <FindLocationMarker
                  xFrac={m.marker.xFrac}
                  yFrac={m.marker.yFrac}
                  pinFilter={style.pinFilter ?? undefined}
                  t={t}
                />
              )}
              {!isAnonymized && status === "no_gps" && (
                <NoGpsMarker t={t} />
              )}
              {isAnonymized && <AnonymizedMapOverlay t={t} />}
              {/* Top-right deep-link chips mirror the per-row buttons
                  in /statistiky's "Top {N} lokalit" table — a quick
                  jump to the location detail page and to the focused
                  /mapa view, accessible without scrolling away from
                  the location map image. Hidden for anonymized finds
                  (the gallery renders a placeholder map; deep-linking
                  to its real location is exactly what we're hiding). */}
              {locationId !== null && (
                <div className="absolute right-2 top-2 z-10 flex items-center gap-1.5">
                  <Link
                    href={`/mapa?focus=${locationId}`}
                    aria-label={t("locMapAria")}
                    title={t("locMapAria")}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-200 bg-white/95 px-2 py-1 text-xs font-medium text-brand-700 shadow-md backdrop-blur transition hover:border-brand-200 hover:shadow-lg"
                  >
                    <MapPin className="h-3.5 w-3.5" aria-hidden />
                    <span className="hidden sm:inline">{t("locMap")}</span>
                  </Link>
                  <Link
                    href={locationDetailHref(locationId)}
                    aria-label={t("locDetailAria")}
                    title={t("locDetailAria")}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-200 bg-white/95 px-2 py-1 text-xs font-medium text-brand-700 shadow-md backdrop-blur transition hover:border-brand-200 hover:shadow-lg"
                  >
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    <span className="hidden sm:inline">
                      {t("locDetail")}
                    </span>
                  </Link>
                </div>
              )}
            </div>
            {m.description && !isAnonymized && (
              <figcaption className="px-3 pt-2 text-xs text-gray-600">
                {m.description}
              </figcaption>
            )}
          </figure>
        );
      })}
    </div>
  );
}

/** Composes the status banner label. Status carries the colour, the
 *  text fills in the distance from the offset where applicable. */
function statusLabel(
  status: MapStatus,
  offset: {
    meters: number;
    mode: "polygon" | "center";
    inside: boolean;
  } | null,
  locale: string,
  t: FindDetailT,
): string {
  if (status === "no_gps") return t("mapStatusNoGps");
  if (status === "outside_map") {
    // Even though `marker.kind === "outside"` (the find is past the
    // map's bbox), we may still have a numeric `meters` from the
    // offset — surface it when known so the visitor sees how far
    // off-map the find actually is. Center-mode locations word it
    // as "od středu mapy", polygon-mode as "od hrany polygonu".
    if (!offset) return t("mapStatusOutsideMap");
    const distance = formatDistance(offset.meters, locale);
    return offset.mode === "center"
      ? t("mapStatusOutsideMapFromCenter", { distance })
      : t("mapStatusOutsideMapFromPolygon", { distance });
  }
  if (status === "outside_polygon" && offset) {
    return t("mapStatusOutsidePolygon", {
      distance: formatDistance(offset.meters, locale),
    });
  }
  // in_polygon status covers two semantically different "inside"
  // cases that must not share copy:
  //   - polygon mode → find is inside the AOI polygon; `meters` is
  //     distance from the polygon edge (≈0 here), not useful to
  //     surface. Use the plain "uvnitř polygonu" wording.
  //   - center mode → location has no polygon at all, only a centre
  //     point. Saying "uvnitř polygonu" would be a lie. Word it as
  //     "v mapě lokality" + distance from the map centre.
  if (offset && offset.mode === "center") {
    return t("mapStatusInMapFromCenter", {
      distance: formatDistance(offset.meters, locale),
    });
  }
  return t("mapStatusInPolygon");
}

/** Centred grey clover for the no-GPS case — substitutes for the
 *  normal pin so the layout doesn't shift and the visitor still has
 *  a visual cue that the map block belongs to a find (just one with
 *  unknown coordinates). */
function NoGpsMarker({ t }: { t: FindDetailT }) {
  return (
    <span
      role="img"
      aria-label={t("findMarkerNoGpsAria")}
      className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2"
      style={{
        filter:
          "drop-shadow(0 0 8px rgba(156,163,175,0.55)) drop-shadow(0 1px 2px rgba(0,0,0,0.3))",
      }}
    >
      <svg viewBox="0 0 32 40" width={36} height={44} aria-hidden focusable={false}>
        <path
          d="M16 40 L8 26 A12 12 0 1 1 24 26 Z"
          fill="#fff"
          stroke="#fff"
          strokeWidth={2}
        />
        <g fill="#9ca3af">
          <circle cx={16} cy={11} r={5} />
          <circle cx={11} cy={16} r={5} />
          <circle cx={21} cy={16} r={5} />
          <circle cx={16} cy={21} r={5} />
          <circle cx={16} cy={16} r={3} fill="#6b7280" />
        </g>
      </svg>
    </span>
  );
}

/** Full-image overlay for anonymized finds. Heavy backdrop blur hides
 *  the placeholder map detail; the giant `?` plus a sub-label make it
 *  unambiguous that the visible map is not the real find location. */
function AnonymizedMapOverlay({ t }: { t: FindDetailT }) {
  return (
    <div
      role="img"
      aria-label={t("anonMapAria")}
      className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-purple-950/45 backdrop-blur-md"
    >
      <span
        aria-hidden
        className="select-none text-7xl font-black text-purple-50 drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)] sm:text-8xl"
      >
        ?
      </span>
      <span className="select-none rounded-full bg-purple-50/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-purple-900 shadow-sm">
        {t("anonMapBadge")}
      </span>
    </div>
  );
}

/** Pin marker overlaid on a location-map image at the find's GPS.
 *  Anchors so the visual "tip" of the clover sits on the actual point —
 *  bottom centre via translate(-50%, -100%). White stroke + drop-shadow
 *  guarantees visibility on grass / pavement / dark roof alike.
 *
 *  `pinFilter` optionally replaces the default drop-shadow with a
 *  colour-tinted glow + the same shadow underneath — drives the
 *  status halo (emerald / amber / rose) per MAP_STATUS_STYLES. */
function FindLocationMarker({
  xFrac,
  yFrac,
  pinFilter,
  t,
}: {
  xFrac: number;
  yFrac: number;
  pinFilter?: string;
  t: FindDetailT;
}) {
  return (
    <span
      role="img"
      aria-label={t("findMarkerAria")}
      className="pointer-events-none absolute z-10"
      style={{
        left: `${xFrac * 100}%`,
        top: `${yFrac * 100}%`,
        transform: "translate(-50%, -100%)",
        filter: pinFilter ?? "drop-shadow(0 1px 2px rgba(0,0,0,0.45))",
      }}
    >
      <svg
        viewBox="0 0 32 40"
        width={32}
        height={40}
        aria-hidden
        focusable={false}
      >
        {/* Pin base — a teardrop ending in a sharp tip at (16, 40),
            so the bottom-centre anchor lands right on the GPS point. */}
        <path
          d="M16 40 L8 26 A12 12 0 1 1 24 26 Z"
          fill="#fff"
          stroke="#fff"
          strokeWidth={2}
        />
        {/* Four-leaf clover inside the pin head — four overlapping
            circles in the brand colour. Stem omitted: at 32 px the
            silhouette is more legible without it. */}
        <g fill="#15803d">
          <circle cx={16} cy={11} r={5} />
          <circle cx={11} cy={16} r={5} />
          <circle cx={21} cy={16} r={5} />
          <circle cx={16} cy={21} r={5} />
          <circle cx={16} cy={16} r={3} fill="#0f6e34" />
        </g>
      </svg>
    </span>
  );
}

function Panel({
  title,
  rightSlot,
  children,
}: {
  title: string;
  rightSlot?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {rightSlot}
      </div>
      <dl className="space-y-2">{children}</dl>
    </section>
  );
}

function AdjacentLink({
  direction,
  id,
  hellish = false,
  t,
}: {
  direction: "prev" | "next";
  id: number | null;
  /** When the surrounding page is the hellish #666 variant, the chip
   *  needs red/light colours to stay readable on the dark gradient. */
  hellish?: boolean;
  t: FindDetailT;
}) {
  const label =
    direction === "prev"
      ? t("prevWithId", { id: id ?? 0 })
      : t("nextWithId", { id: id ?? 0 });
  const placeholder =
    direction === "prev" ? t("prevPlaceholder") : t("nextPlaceholder");
  const disabledCls = hellish
    ? "rounded-md border border-red-900/50 px-2 py-1 text-red-300/40"
    : "rounded-md border border-gray-200 px-2 py-1 text-gray-300";
  const activeCls = hellish
    ? "rounded-md border border-red-900/60 px-2 py-1 text-red-200 transition hover:border-red-500/70 hover:text-red-100 hover:bg-red-950/40"
    : "rounded-md border border-gray-200 px-2 py-1 text-gray-700 transition hover:border-brand-200 hover:text-brand-700";
  if (id === null) {
    return (
      <span aria-disabled="true" className={disabledCls}>
        {placeholder}
      </span>
    );
  }
  return (
    <Link href={`/sbirka/${id}`} className={activeCls}>
      {label}
    </Link>
  );
}

function KeyValue({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-xs font-medium text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-800">{value}</dd>
    </div>
  );
}

/** Prev / next chip rendered under the rank line in the Lokalita
 *  panel. When `targetId` is null the chip stays in place but
 *  renders as a faded, non-interactive span — keeping both slots
 *  visible at the chain edges so the next/prev pair doesn't shift
 *  around between finds. */
function LocationNavLink({
  direction,
  targetId,
  label,
}: {
  direction: "prev" | "next";
  targetId: number | null;
  label: string;
}) {
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
  const baseCls =
    "inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition";
  if (targetId === null) {
    return (
      <span
        aria-disabled
        className={`${baseCls} cursor-not-allowed border-gray-100 bg-gray-50 text-gray-400`}
      >
        {direction === "prev" && <Icon className="h-3.5 w-3.5" aria-hidden />}
        {label}
        {direction === "next" && <Icon className="h-3.5 w-3.5" aria-hidden />}
      </span>
    );
  }
  return (
    <Link
      href={`/sbirka/${targetId}`}
      className={`${baseCls} border-gray-200 bg-white text-brand-700 hover:border-brand-200 hover:shadow-sm`}
    >
      {direction === "prev" && <Icon className="h-3.5 w-3.5" aria-hidden />}
      {label}
      {direction === "next" && <Icon className="h-3.5 w-3.5" aria-hidden />}
    </Link>
  );
}

/** Chip rendering a "jump to first / last find at this location" link
 *  — just the rank number with a period (`1.`, `23.`). When the
 *  current find IS the first / last, the chip renders as a faded
 *  non-interactive span so the navigation row's button positions
 *  stay stable across finds. Sibling of `LocationNavLink`. */
function LocationExtremeLink({
  targetId,
  label,
  ariaLabel,
  isCurrent,
}: {
  targetId: number;
  label: string;
  ariaLabel: string;
  isCurrent: boolean;
}) {
  const baseCls =
    "inline-flex items-center justify-center rounded-md border px-2 py-1.5 text-xs font-mono font-semibold tabular-nums transition";
  if (isCurrent) {
    return (
      <span
        aria-disabled
        aria-label={ariaLabel}
        title={ariaLabel}
        className={`${baseCls} cursor-not-allowed border-gray-100 bg-gray-50 text-gray-400`}
      >
        {label}
      </span>
    );
  }
  return (
    <Link
      href={`/sbirka/${targetId}`}
      aria-label={ariaLabel}
      title={ariaLabel}
      className={`${baseCls} border-gray-200 bg-white text-brand-700 hover:border-brand-200 hover:shadow-sm`}
    >
      {label}
    </Link>
  );
}
