import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Ghost,
  MapPin,
  Trophy,
} from "lucide-react";
import { FindState, ImageType } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { DetailVibeOverlay } from "@/components/finds/detail-vibe-overlay";
import { GpsValue } from "@/components/finds/gps-value";
import { ImageGallery } from "@/components/finds/image-gallery";
import { LostOverlay } from "@/components/finds/lost-overlay";
import { BackToSbirkaLink } from "@/components/finds/sbirka-back-link";
import { StateBadges } from "@/components/finds/state-badges";
import { VoteButton } from "@/components/finds/vote-button";
import {
  formatAreaM2,
  formatDateTimeCs,
  formatDensity,
  formatDistance,
  formatLocationId,
  locationDetailHref,
} from "@/lib/format";
import { FIND_DEVIATION_RADIUS_M } from "@/lib/constants";
import { effectForFind } from "@/lib/specialFinds";
import { getSpecialFinds } from "@/lib/specialFinds.server";
import { localePath, ogLocale, seoAlternates } from "@/lib/seo";
import { breadcrumbSchema, findImageSchema } from "@/lib/schema";
import { JsonLd } from "@/components/seo/json-ld";
import { isFormerLocation } from "@/lib/locationCode";
import {
  getAdjacentFindIds,
  getAllFindIds,
  getFindById,
  type PublicLocationMap,
} from "@/lib/queries/finds";
import {
  getLocationAreaDensity,
  getLocationFindCountRank,
} from "@/lib/queries/locations";
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
  const { id, locale } = await params;
  const t = await getTranslations("FindDetail");
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) {
    return { title: t("metaNotFound") };
  }
  const find = await getFindById(numId);
  if (!find) {
    return { title: t("metaNotFound") };
  }
  // Anonymized finds must not be indexed and must not leak data in meta tags
  // (no canonical / OG image either — nothing that ties them to a URL).
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
  const path = `/sbirka/${find.id}`;
  // The find's photo becomes the social-share image. `primaryImage` is
  // null for NO_PHOTO finds → we simply omit it and the card stays text.
  const img = find.primaryImage;
  const ogImages = img
    ? [{ url: img.webPath, width: img.width, height: img.height, alt: title }]
    : undefined;
  return {
    title,
    description,
    alternates: seoAlternates(path, locale),
    openGraph: {
      title,
      description,
      type: "article",
      locale: ogLocale(locale),
      url: localePath(path, locale),
      ...(ogImages ? { images: ogImages } : {}),
    },
    ...(ogImages
      ? { twitter: { card: "summary_large_image", images: [img!.webPath] } }
      : {}),
  };
}

export default async function FindDetailPage({ params }: PageProps) {
  const { id, locale } = await params;
  const t = await getTranslations("FindDetail");
  const tNav = await getTranslations("Nav");
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) notFound();
  const [find, adjacent] = await Promise.all([
    getFindById(numId),
    getAdjacentFindIds(numId),
  ]);
  if (!find) notFound();

  // Location area + find density and the location's rank in the public
  // "Top lokalit" ordering, both for the "Lokalita" panel. Skipped for
  // anonymized finds (the real location is hidden) and finds with no
  // location. Polygon-free spots come back flagged as an estimate.
  const [areaDensity, locationRank] =
    !find.isAnonymized && find.location
      ? await Promise.all([
          getLocationAreaDensity(find.location.id),
          getLocationFindCountRank(find.location.id),
        ])
      : [null, null];

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

  // Special atmospheric effect for this find (record / heavenly /
  // hellish), resolved from the admin-assignable config (defaults seed
  // 111→heavenly, 666→hellish, record→record). The overlay is full-
  // viewport `position: fixed` so it doesn't affect layout; `hellish`
  // also darkens the article gradient.
  const effect = effectForFind(find.id, await getSpecialFinds());
  const hellish = effect === "hellish";

  // LOST finds get a quiet elegy treatment, driven by the data state
  // (not the admin effect config): muted gallery photos, a dashed
  // banner, and — unless a config-assigned effect already owns the
  // viewport — a sparse rising shower of dissolving clovers.
  const isLost = find.states.includes(FindState.LOST);

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

  // Overlay affordances drawn on top of the find photo (inside
  // ImageGallery): a round "show on map" pin in the top-LEFT corner and
  // the vote button top-RIGHT, next to the crop magnifier. Built here so
  // the gallery stays free of find-detail specifics; passed down as
  // ready-made nodes. Both follow the same visibility rules they had in
  // the header (map needs public GPS, vote needs a photo).
  const mapSlot = find.coordinates ? (
    <Link
      href={`/mapa?find=${find.id}`}
      aria-label={t("showOnMap")}
      title={t("showOnMap")}
      className="rounded-full bg-white/90 p-2 text-gray-700 shadow-md ring-1 ring-black/5 backdrop-blur transition hover:bg-white hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
    >
      <MapPin className="h-5 w-5" aria-hidden />
    </Link>
  ) : null;
  const voteSlot = !isNoPhoto ? (
    <VoteButton
      findId={find.id}
      initialVoted={voted}
      initialCount={voteCount}
      variant="overlay"
    />
  ) : null;

  const detail = (
    <article className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      {/* Bar: "Zpět na sbírku" on the left, and the find title —
          "🍀 #id" — centered with the prev/next find links flanking it
          (prev left, next right). On desktop the title group is centered
          across the whole bar via a 1fr/auto/1fr grid; on mobile it drops
          to its own second row (it won't fit beside the back link). */}
      <nav
        aria-label={t("navAriaLabel")}
        className={`flex flex-col gap-3 text-sm sm:grid sm:grid-cols-[1fr_auto_1fr] sm:items-center ${
          hellish ? "text-red-300/80" : "text-gray-500"
        }`}
      >
        <div className="sm:justify-self-start">
          <BackToSbirkaLink />
        </div>
        <div className="flex items-center justify-center gap-3">
          <CloverNavLink
            direction="prev"
            id={adjacent.prevId}
            hellish={hellish}
            t={t}
          />
          <h1
            aria-label={t("h1", { id: find.id })}
            className={`whitespace-nowrap text-2xl font-bold ${
              hellish ? "text-red-100" : "text-gray-900"
            }`}
          >
            <span aria-hidden>🍀 #{find.id}</span>
          </h1>
          <CloverNavLink
            direction="next"
            id={adjacent.nextId}
            hellish={hellish}
            t={t}
          />
        </div>
        <div className="hidden sm:block" aria-hidden />
      </nav>

      <header className="space-y-3">
        {/* State badges (Darovaný, Anonymizovaný, …) — the title moved up
            into the nav bar and the map/vote affordances moved onto the
            photo, so the badges stand alone here, centered. Multiple
            states stack when a find carries more than one. */}
        {find.states.length > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-3">
            <StateBadges states={find.states} />
          </div>
        )}

        {/* Czech-record banner — the milestone find for the largest CZ
            collection. Shown whenever the admin-assignable special-find
            config (src/lib/specialFinds.*) resolves this find to the
            "record" effect. The celebratory overlay is rendered
            separately via DetailVibeOverlay. */}
        {effect === "record" && (
          <div className="flex flex-wrap items-center justify-center gap-2 rounded-xl border border-amber-300 bg-gradient-to-r from-amber-50 via-yellow-50 to-amber-50 px-4 py-2.5 text-center text-sm font-semibold text-amber-900 shadow-sm">
            <Trophy className="h-5 w-5 shrink-0 text-amber-500" aria-hidden />
            {t("recordBadge")}
          </div>
        )}

        {/* Lost-find elegy banner — quiet stone tones + dashed border,
            the textual half of the LOST treatment (muted photos and
            the rising-clover overlay are rendered elsewhere). */}
        {isLost && (
          <div className="flex flex-wrap items-center justify-center gap-2 rounded-xl border border-dashed border-stone-300 bg-stone-50 px-4 py-2.5 text-center text-sm font-medium text-stone-600">
            <Ghost className="h-5 w-5 shrink-0 text-stone-400" aria-hidden />
            {t("lostBanner")}
          </div>
        )}

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

      {/* Time & position — frameless (no card) block, centered under the
          nav. Just the heading, the date/time (no label) and the GPS
          (with its format-toggle button, as before). The offset now lives
          as the banner above the location map and the distance-from-MAP
          00001 row was noise, so both are gone. The photo follows, with
          the show-on-map pin + vote button drawn over it. */}
      <section className="space-y-3">
        <h2
          className={`text-center text-sm font-semibold ${
            hellish ? "text-red-100" : "text-gray-900"
          }`}
        >
          {t("panelMeta")}
        </h2>
        <p
          className={`text-center text-sm ${
            hellish ? "text-red-100/90" : "text-gray-800"
          }`}
        >
          {formatDateTimeCs(find.foundAt, locale)}
        </p>
        {!find.isAnonymized && find.coordinates && (
          <div className="flex justify-center">
            <GpsValue
              lat={find.coordinates.lat}
              lng={find.coordinates.lng}
              tone={hellish ? "dark" : "default"}
            />
          </div>
        )}
        <div className="pt-2">
          <ImageGallery
            image={mainImage}
            cropImage={cropImage}
            altBase={t("imageAlt", { id: find.id })}
            findId={find.id}
            donationPhotos={find.donationPhotos}
            freePhotos={find.freePhotos}
            muted={isLost}
            mapSlot={mapSlot}
            voteSlot={voteSlot}
          />
        </div>
      </section>

      {find.isAnonymized && (
        <p className="rounded-md border border-purple-200 bg-purple-50 p-3 text-sm text-purple-900">
          {t("anonymizedNotice")}
        </p>
      )}

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        {/* Facts + prev/next nav fill the LEFT (flex-1), the location map is
            pinned to the RIGHT at its natural width (no centering gap, no
            empty strip). `lg:items-start` lines the top of the facts column
            up with the top edge of the map, and the section title lives as
            the first row of that column — so the map sits flush at the panel
            top with no header row above it. Collapses to a single stacked
            column on mobile (title → facts → nav → map). */}
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1 space-y-2">
            {/* Section title + location-id chip as the first row, vertically
                centered and level with the map's top edge. The id is hidden
                for anonymized finds — it would be the privacy placeholder
                (#00001) and sit contradictorily next to the "skutečná
                lokalita se nezobrazuje" notice. */}
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-gray-900">
                {t("panelLocation")}
              </h2>
              {!find.isAnonymized && find.location && (
                <span className="font-mono text-xs text-gray-500">
                  {formatLocationId(find.location.id)}
                </span>
              )}
            </div>
            {find.isAnonymized ? (
              /* Anonymized finds get only the short notice — no location
                 code, displayName, rank or nav (privacy placeholder or an
                 outright leak). The placeholder map still renders on the
                 right. */
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
                    {/* Neither the location code nor the description is
                        repeated here — the code is baked into the map's
                        bottom-right watermark and the description sits as the
                        caption under the map. */}
                    <dl className="space-y-2">
                      {areaDensity && (
                        <>
                          <KeyValue
                            label={
                              areaDensity.areaIsEstimate
                                ? t("kvAreaEstimate")
                                : t("kvArea")
                            }
                            value={
                              <span>
                                {areaDensity.areaIsEstimate ? "≈ " : ""}
                                {formatAreaM2(areaDensity.effectiveAreaM2)}
                                {areaDensity.areaIsEstimate && (
                                  <span className="ml-1 text-xs text-gray-500">
                                    {t("kvAreaEstimateNote")}
                                  </span>
                                )}
                              </span>
                            }
                          />
                          {areaDensity.densityPer100m2 !== null && (
                            <KeyValue
                              label={t("kvDensity")}
                              value={
                                <span>
                                  {areaDensity.areaIsEstimate ? "≈ " : ""}
                                  {formatDensity(areaDensity.densityPer100m2)}
                                </span>
                              }
                            />
                          )}
                        </>
                      )}
                      {locationRank && (
                        <KeyValue
                          label={t("kvLocationRank")}
                          value={
                            <span className="inline-flex flex-wrap items-baseline justify-end gap-x-2 gap-y-1">
                              <span>
                                {t("locationRankValue", {
                                  rank: locationRank.rank,
                                  total: locationRank.total,
                                })}
                                <span className="ml-1 text-xs text-gray-500">
                                  {t("locationRankNote")}
                                </span>
                              </span>
                              {/* Deep-links to /statistiky and force-opens +
                                scrolls the "Top lokalit" section (anchor
                                handled by CollapsibleSection#top-locations). */}
                              <Link
                                href="/statistiky#top-locations"
                                className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-0.5 text-xs font-medium text-brand-700 transition hover:border-brand-200 hover:text-brand-800 hover:shadow-sm"
                              >
                                <BarChart3
                                  className="h-3.5 w-3.5"
                                  aria-hidden
                                />
                                {t("locationRankLink")}
                              </Link>
                            </span>
                          }
                        />
                      )}
                      {find.rankAtLocation && (
                        <KeyValue
                          label={t("kvOrderAtLocation")}
                          value={t("orderAtLocationValue", {
                            rank: find.rankAtLocation.rank,
                            total: find.rankAtLocation.total,
                          })}
                        />
                      )}
                    </dl>
                    {find.rankAtLocation && find.rankAtLocation.total > 1 && (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {/* first/prev pinned to the LEFT, next/last pushed to
                            the RIGHT (ml-auto keeps the second group
                            right-aligned even when the narrow column forces it
                            onto its own line). Each chip stays rendered (faded)
                            at the chain boundary so positions don't shift
                            between finds. */}
                        <div className="flex items-center gap-2">
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
                        </div>
                        <div className="ml-auto flex items-center gap-2">
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
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-gray-600">{t("noLocation")}</p>
                )}
              </>
            )}
          </div>

          {find.locationMaps.length > 0 && (
            <div className="w-full lg:w-[40rem] lg:shrink-0">
              <LocationMapsGallery
                maps={find.locationMaps}
                locationOffset={find.locationOffset}
                isAnonymized={find.isAnonymized}
                /* locationId is non-null only when the gallery actually
                   represents the find's real location — anonymized finds
                   render the placeholder and we don't deep-link to it. */
                locationId={
                  find.isAnonymized ? null : (find.location?.id ?? null)
                }
                locale={locale}
                t={t}
              />
            </div>
          )}
        </div>
      </section>
    </article>
  );

  // Structured data — breadcrumb + the find as an ImageObject. Built only
  // for public finds; anonymized finds are noindex and must not surface
  // location/GPS in JSON-LD (CLAUDE.md §6).
  const findLocationName =
    find.location?.displayName ?? find.location?.code ?? null;
  const jsonLd = find.isAnonymized
    ? null
    : [
        breadcrumbSchema([
          { name: tNav("home"), path: "/" },
          { name: tNav("sbirka"), path: "/sbirka" },
          { name: `#${find.id}`, path: `/sbirka/${find.id}` },
        ]),
        findImageSchema({
          name: t("metaTitle", {
            id: find.id,
            locationName: findLocationName ?? t("fallbackLocation"),
          }),
          description: t("metaDescription", {
            locationName: findLocationName ?? t("fallbackLocation"),
          }),
          contentUrl: find.primaryImage?.webPath ?? null,
          thumbnailUrl: find.primaryImage?.thumbPath ?? null,
          foundAt: find.foundAt ? find.foundAt.toISOString() : null,
          locationName: findLocationName,
          coordinates: find.coordinates,
        }),
      ];

  return (
    <>
      {jsonLd && <JsonLd data={jsonLd} />}
      <DetailVibeOverlay effect={effect} />
      {/* The lost elegy only owns the viewport when no config-assigned
          effect is active — stacking two particle systems would read
          as noise rather than mood. */}
      {isLost && !effect && <LostOverlay />}
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
  offset: {
    meters: number;
    mode: "polygon" | "center";
    inside: boolean;
  } | null,
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
            className="mx-auto w-full max-w-2xl overflow-hidden rounded-md border border-gray-200 bg-gray-50"
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
                <span>{statusLabel(status, locationOffset, locale, t)}</span>
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
                width={m.imageWidth ?? undefined}
                height={m.imageHeight ?? undefined}
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
              {!isAnonymized && status === "no_gps" && <NoGpsMarker t={t} />}
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
                    <span className="hidden sm:inline">{t("locDetail")}</span>
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
      <svg
        viewBox="0 0 32 40"
        width={36}
        height={44}
        aria-hidden
        focusable={false}
      >
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

/** Subtle prev / next find link flanking the title in the top bar —
 *  rendered as a quiet "🍀 #id" text link (not a boxed button). At the
 *  ends of the collection (`id === null`) it degrades to a faded,
 *  non-interactive clover so the title stays roughly centered and the
 *  boundary reads as "nothing beyond here". */
function CloverNavLink({
  direction,
  id,
  hellish = false,
  t,
}: {
  direction: "prev" | "next";
  id: number | null;
  /** When the surrounding page is the hellish #666 variant, the link
   *  needs red/light colours to stay readable on the dark gradient. */
  hellish?: boolean;
  t: FindDetailT;
}) {
  if (id === null) {
    return (
      <span
        aria-hidden
        className={`select-none text-lg ${
          hellish ? "text-red-300/25" : "text-gray-300"
        }`}
      >
        🍀
      </span>
    );
  }
  const label =
    direction === "prev" ? t("prevWithId", { id }) : t("nextWithId", { id });
  const cls = hellish
    ? "text-red-300/80 transition hover:text-red-100"
    : "text-gray-500 transition hover:text-brand-700";
  return (
    <Link
      href={`/sbirka/${id}`}
      aria-label={label}
      title={label}
      className={`whitespace-nowrap font-mono text-sm ${cls}`}
    >
      🍀 #{id}
    </Link>
  );
}

function KeyValue({ label, value }: { label: string; value: React.ReactNode }) {
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
