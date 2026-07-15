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
import { FindKeyNav } from "@/components/finds/find-key-nav";
import { LostOverlay } from "@/components/finds/lost-overlay";
import { AnonymizedOverlay } from "@/components/finds/anonymized-overlay";
import { DonatedOverlay } from "@/components/finds/donated-overlay";
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
import { versionedPhotoUrl } from "@/lib/assetVersion";
import { photoDisplay } from "@/lib/photoBox";
import { getFindNoteOverride } from "@/lib/findNoteOverrides";
import {
  readMapNoteOverrides,
  type MapNoteOverride,
} from "@/lib/mapNoteOverrides";
import { readBannerTextOverrides } from "@/lib/bannerTextOverrides";
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

// Min width (px) for the prev/next NAV bar's "Zpět na sbírku" column only.
// The back link is pinned to the LEFT of this centered column; flooring it
// keeps it clear of the centered prev/next links even when the photo below is
// narrow. The photo, map + facts keep their own (possibly narrower) width —
// i.e. the nav bar no longer shrinks to a small photo. Wide photos already
// exceed this, so the nav then aligns to the photo exactly as before.
// 768px verified to clear the back button (both the longer EN label and CS)
// from the centered prev/next with comfortable margin.
const NAV_MIN_WIDTH_PX = 768;

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
    ? [
        {
          url: versionedPhotoUrl(img.webPath),
          width: img.width,
          height: img.height,
          alt: title,
        },
      ]
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
      ? {
          twitter: {
            card: "summary_large_image",
            images: [versionedPhotoUrl(img!.webPath)],
          },
        }
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

  // Displayed photo geometry (height-capped, landscape rotated to portrait).
  // The photo + location map + facts share `photoBox.widthCss` (native,
  // height-capped) so they line up; the prev/next nav bar uses the wider
  // `photoBox.layoutWidthCss` (floored at NAV_MIN_WIDTH_PX) so the back link
  // never overlaps the centered prev/next on a narrow photo — the photo just
  // sits at its own (smaller) width beneath the roomier nav. For NO_PHOTO
  // finds there's no real image, so we fall back to a default 3:4 portrait
  // box — the placeholder occupies the area a real photo would.
  const photoBox =
    photoDisplay(mainImage?.width, mainImage?.height, {
      rotate: true,
      minWidthPx: NAV_MIN_WIDTH_PX,
    }) ??
    photoDisplay(900, 1200, { rotate: false, minWidthPx: NAV_MIN_WIDTH_PX })!;

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
  // ImageGallery), built here so the gallery stays free of find-detail
  // specifics: a green "show on map" pin (top-LEFT), the vote button
  // (top-RIGHT, next to the crop magnifier) and the state badges
  // (bottom-LEFT). Visibility mirrors the old header rules — map needs
  // public GPS, vote needs a photo.
  const mapSlot = find.coordinates ? (
    <Link
      href={`/mapa?find=${find.id}`}
      aria-label={t("showOnMap")}
      title={t("showOnMap")}
      className="inline-flex items-center justify-center rounded-full bg-white/90 p-2 text-brand-700 shadow-md ring-1 ring-black/5 backdrop-blur transition hover:bg-white hover:text-brand-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
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
  const statesSlot =
    find.states.length > 0 ? <StateBadges states={find.states} /> : null;

  // Date/time + GPS as photo overlays (bottom-left / bottom-center),
  // mirroring the random-clover showcase on the home page. The date is
  // pinned to Europe/Prague (the collection's zone) so it matches the
  // showcase and doesn't depend on the server's timezone. GPS keeps its
  // format toggle; it's hidden for anonymized finds, and shows a
  // question-mark placeholder for NO_GPS finds that have a photo.
  // Both photo overlays share one pill shape + fixed height so the GPS panel
  // is exactly as tall as the date/time one (compact GpsValue keeps its
  // button from bloating the row).
  const overlayPillCls =
    "inline-flex h-7 items-center rounded-md bg-white/90 px-2 shadow-md ring-1 ring-black/5 backdrop-blur";
  const dateSlot = (
    <span className={`${overlayPillCls} text-xs font-medium text-brand-700`}>
      {formatDateTimeCs(find.foundAt, locale, "Europe/Prague")}
    </span>
  );
  const gpsSlot =
    !find.isAnonymized && find.coordinates ? (
      <div className={overlayPillCls}>
        <GpsValue
          lat={find.coordinates.lat}
          lng={find.coordinates.lng}
          tone="brand"
          compact
        />
      </div>
    ) : !find.isAnonymized &&
      !find.coordinates &&
      find.states.includes(FindState.NO_GPS) ? (
      <div className={`${overlayPillCls} gap-1.5 text-xs`}>
        <span className="font-medium uppercase tracking-wide text-brand-700">
          GPS
        </span>
        <span className="font-mono text-brand-600">{t("gpsUnknownValue")}</span>
      </div>
    ) : null;

  // Admin-managed banner-text overrides (data/.admin/banner-texts.json) take
  // precedence over the baked-in FindDetail defaults, per locale; bt()
  // resolves one banner's effective text.
  const bannerOverrides = await readBannerTextOverrides();
  const bt = (key: string): string => {
    const ov = bannerOverrides.get(key);
    const o = locale === "en" ? ov?.en : ov?.cs;
    return o || t(key);
  };

  // Full-width explanatory banners stacked ABOVE the photo, one per
  // relevant state (a find can carry several — e.g. Gigant + Darovaný).
  // Each uses its state's tone. The find note is the mirror banner BELOW.
  const STATE_BANNERS: ReadonlyArray<{
    state: FindState;
    text: string;
    cls: string;
    icon?: React.ReactNode;
  }> = [
    {
      state: FindState.LOST,
      text: bt("lostBanner"),
      cls: "border-stone-200 bg-stone-50 text-stone-600",
      icon: <Ghost className="h-4 w-4 shrink-0 text-stone-400" aria-hidden />,
    },
    {
      state: FindState.ANONYMIZED,
      text: bt("anonymizedNotice"),
      cls: "border-purple-200 bg-purple-50 text-purple-900",
    },
    {
      state: FindState.DONATED,
      text: bt("stateBannerDonated"),
      cls: "border-amber-200 bg-amber-50 text-amber-900",
    },
    {
      state: FindState.GIGANT,
      text: bt("stateBannerGigant"),
      cls: "border-emerald-200 bg-emerald-50 text-emerald-800",
    },
    {
      state: FindState.NO_GPS,
      text: bt("stateBannerNoGps"),
      cls: "border-yellow-200 bg-yellow-50 text-yellow-800",
    },
    {
      state: FindState.NO_PHOTO,
      text: bt("stateBannerNoPhoto"),
      cls: "border-slate-200 bg-slate-50 text-slate-700",
    },
  ];
  const activeBanners = STATE_BANNERS.filter((b) =>
    find.states.includes(b.state),
  );
  const bannerEls: React.ReactNode[] = [];
  // The Czech-record banner (a config effect, not a state) leads, in gold.
  if (effect === "record") {
    bannerEls.push(
      <div
        key="record"
        className="flex items-center justify-center gap-2 border-b border-amber-300 bg-gradient-to-r from-amber-50 via-yellow-50 to-amber-50 px-3 py-2 text-center text-xs font-semibold text-amber-900"
      >
        <Trophy className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />
        <span>{bt("recordBadge")}</span>
      </div>,
    );
  }
  for (const b of activeBanners) {
    bannerEls.push(
      <div
        key={b.state}
        className={`flex items-center justify-center gap-2 border-b px-3 py-2 text-center text-xs ${b.cls}`}
      >
        {b.icon}
        <span>{b.text}</span>
      </div>,
    );
  }
  const photoTopBanner = bannerEls.length > 0 ? <>{bannerEls}</> : null;

  // Note shown in the banner under the photo. An admin-managed override
  // (data/.admin/find-note-overrides.json) takes precedence over the raw
  // LSP-JSON note — it can carry characters the filename can't and an
  // optional EN variant. Same privacy gate as the query's `find.notes`:
  // never for anonymized / donated finds.
  const noteOverride =
    !find.isAnonymized && !find.states.includes(FindState.DONATED)
      ? await getFindNoteOverride(find.id)
      : null;
  const noteCs = noteOverride?.cs || find.notes || null;
  const noteEn = noteOverride?.en || null;
  // Web-display caption overrides for this find's location map(s), keyed by
  // MAP_ID — the same admin-authored display layer as the find note above.
  // The gallery applies the CS/EN fallback per map. (No privacy gate here:
  // the map caption itself is already hidden for anonymized finds below.)
  const mapNoteOverrides = await readMapNoteOverrides();
  // EN with its own override → show it untranslated-flag-free. Otherwise
  // fall back to the CS text + the Czech-only flag (machine-translating
  // user notes would ship possibly-sensitive text to a third party).
  const noteNode =
    locale === "en" && noteEn ? (
      <span>{noteEn}</span>
    ) : noteCs ? (
      <>
        <span>{noteCs}</span>
        {locale === "en" && (
          <span className="mt-1 block text-[11px] italic opacity-70">
            {t("czechOnly")}
          </span>
        )}
      </>
    ) : null;

  const detail = (
    <article className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      {/* ← / → keyboard navigation to the neighbouring finds. */}
      <FindKeyNav prevId={adjacent.prevId} nextId={adjacent.nextId} />
      {/* Bar: the find title — "🍀 #id" — centered with the prev/next find
          links flanking it (prev left, next right).

          The "Zpět na sbírku" button is an overlay pinned to the LEFT EDGE
          OF THE PHOTO (the centered photo-width column), vertically centered
          on the bar so it reads on the SAME line as the prev/next nav and
          lines up with the image below. From `md` up only; below `md` it's
          hidden and the app-bar "Sbírka" chip takes over (see main-nav.tsx),
          so the back jumps up to the top bar on narrow screens.
          pointer-events pass through everywhere except the button so the
          centered nav behind it stays clickable. */}
      <nav
        aria-label={t("navAriaLabel")}
        className={`relative flex flex-col gap-3 text-sm ${
          hellish ? "text-red-300/80" : "text-gray-500"
        }`}
      >
        <div className="pointer-events-none absolute inset-x-0 top-1/2 hidden -translate-y-1/2 md:block">
          <div
            className="mx-auto"
            style={{ width: photoBox.layoutWidthCss, maxWidth: "100%" }}
          >
            <span className="pointer-events-auto inline-flex">
              <BackToSbirkaLink variant="button-full" />
            </span>
          </div>
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
            <span aria-hidden>🍀#{find.id}</span>
          </h1>
          <CloverNavLink
            direction="next"
            id={adjacent.nextId}
            hellish={hellish}
            t={t}
          />
        </div>
      </nav>

      {/* All the find's badges/notices now live on the photo itself: state
          badges as an overlay, the record/anonymized/lost/… notices as
          banners ABOVE it, the note as a banner BELOW. So there's no
          separate header block — the photo section follows the nav. */}

      {/* The photo carries everything as overlays now: date/time
          (bottom-left), GPS with its format toggle (bottom-center), the
          show-on-map pin, the vote button, the state badges and the
          record/anonymized/lost/… banners. The map offset lives as a
          banner over the location map; the distance-from-MAP-00001 row was
          noise — both gone. */}
      <section>
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
          statesSlot={statesSlot}
          dateSlot={dateSlot}
          gpsSlot={gpsSlot}
          note={noteNode}
          topBanner={photoTopBanner}
          bordered
          goldFrame={effect === "record"}
          rotateLandscape
          placeholderWidthCss={photoBox.widthCss}
          placeholderAspectRatio={photoBox.aspectRatio}
        />
      </section>

      {/* Lokalita — frameless, stacked and centered like the meta block.
          A bigger centered "Lokalita" heading sits above the (centered)
          location map; the map carries the location number as a bold
          top-left overlay. The facts and the per-location find navigation
          sit BELOW the map, constrained to the map's width so labels line
          up with its left edge and values with its right. HIDDEN entirely
          for anonymized finds — the real location must not surface, so
          there's no heading and no placeholder map (the anonymized notice
          rides as the banner above the photo instead). */}
      {!find.isAnonymized && (
        <section className="space-y-4">
          <h2
            className={`text-center text-lg font-semibold ${
              hellish ? "text-red-100" : "text-gray-900"
            }`}
          >
            {t("panelLocation")}
          </h2>

          {find.locationMaps.length > 0 && (
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
              /* Location number overlaid bold on the map's top-left corner;
               hidden for anonymized finds (would be the #00001 placeholder). */
              locationBadge={
                !find.isAnonymized && find.location
                  ? formatLocationId(find.location.id)
                  : null
              }
              /* Match the map exactly to the find photo's displayed width so
               the two line up (falls back to max-w-2xl when there's no
               photo to measure against). */
              figureWidth={photoBox?.widthCss}
              locale={locale}
              t={t}
              noteOverrides={mapNoteOverrides}
            />
          )}

          {/* Below the map, constrained to the SAME width as the photo/map
            above so the facts' labels/values align with the map's left/
            right edges (falls back to max-w-2xl when there's no photo).
            On the hellish #666 the whole detail sits on a near-black
            gradient — the grey facts/nav would vanish, so they get a light
            card to read against (the map above already is one). */}
          <div
            className={`mx-auto w-full space-y-3 ${photoBox ? "" : "max-w-2xl"} ${
              hellish ? "rounded-xl bg-white/90 p-4" : ""
            }`}
            style={
              photoBox
                ? { width: photoBox.widthCss, maxWidth: "100%" }
                : undefined
            }
          >
            {find.isAnonymized ? (
              /* Anonymized finds get only the short notice — no location
               code, displayName, rank or nav (privacy placeholder or an
               outright leak). The placeholder map still renders above. */
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
                      repeated here — the code is the top-left map overlay
                      and the description sits as the caption under the map. */}
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
                      /* Per-location find navigation in the same quiet
                       clover-link style as the top bar. First + prev are
                       pinned to the LEFT edge of the section, next + last
                       to the RIGHT. The "last" chip shows the last find's
                       number (= total rank). Faded (non-interactive) at
                       the chain ends and for the current find's position. */
                      <nav
                        aria-label={t("navAriaLabel")}
                        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 pt-1 text-sm"
                      >
                        <span className="inline-flex items-center gap-2">
                          <LocCloverLink
                            label="1."
                            targetId={find.rankAtLocation.firstId}
                            disabled={find.rankAtLocation.rank === 1}
                            ariaLabel={t("firstAtLocation")}
                          />
                          <LocNavDivider />
                          <LocCloverLink
                            label={t("locNavPrev")}
                            targetId={find.rankAtLocation.prevId}
                            ariaLabel={t("prevAtLocation")}
                          />
                        </span>
                        <span className="inline-flex items-center gap-2">
                          <LocCloverLink
                            label={t("locNavNext")}
                            targetId={find.rankAtLocation.nextId}
                            ariaLabel={t("nextAtLocation")}
                          />
                          <LocNavDivider />
                          <LocCloverLink
                            label={`${find.rankAtLocation.total.toLocaleString(
                              locale === "en" ? "en-GB" : "cs-CZ",
                            )}.`}
                            targetId={find.rankAtLocation.lastId}
                            disabled={
                              find.rankAtLocation.rank ===
                              find.rankAtLocation.total
                            }
                            ariaLabel={t("lastAtLocation")}
                          />
                        </span>
                      </nav>
                    )}
                  </>
                ) : (
                  <p className="text-center text-sm text-gray-600">
                    {t("noLocation")}
                  </p>
                )}
              </>
            )}
          </div>
        </section>
      )}
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
          contentUrl: find.primaryImage
            ? versionedPhotoUrl(find.primaryImage.webPath)
            : null,
          thumbnailUrl: find.primaryImage
            ? versionedPhotoUrl(find.primaryImage.thumbPath)
            : null,
          foundAt: find.foundAt ? find.foundAt.toISOString() : null,
          locationName: findLocationName,
          coordinates: find.coordinates,
        }),
      ];

  return (
    <>
      {jsonLd && <JsonLd data={jsonLd} />}
      <DetailVibeOverlay effect={effect} />
      {/* Ambient particle overlays. Suppressed only when a config-assigned
          effect (record/heavenly/hellish) owns the viewport. Lost and
          anonymized are independent, so an anonymized + lost find rises
          BOTH ghosts and question marks. */}
      {isLost && !effect && <LostOverlay />}
      {find.isAnonymized && !effect && <AnonymizedOverlay />}
      {find.states.includes(FindState.DONATED) && !effect && <DonatedOverlay />}
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
  locationBadge = null,
  figureWidth,
  locale,
  t,
  noteOverrides,
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
  /** Location number (e.g. "#00126") drawn as a bold overlay in the
   *  map image's top-left corner. Null for anonymized finds (the
   *  placeholder must not carry a real-looking id). */
  locationBadge?: string | null;
  /** CSS width to match the map figure to the find photo above it (the
   *  photo's displayed width). Undefined → the default max-w-2xl cap. */
  figureWidth?: string;
  /** Used to format the distance suffix in the status banner. */
  locale: string;
  /** Server-side translator pre-bound to the `FindDetail` namespace.
   *  Passed as a prop instead of re-derived here so the helper stays
   *  a sync function (next-intl's `getTranslations` is async). */
  t: FindDetailT;
  /** Web-display caption overrides keyed by MAP_ID (admin display layer).
   *  Per map the caption shows override.en on EN, else override.cs, else the
   *  raw filename description; EN falls back with a "Czech only" flag. */
  noteOverrides?: Map<number, MapNoteOverride>;
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
            className={`mx-auto w-full overflow-hidden rounded-md border border-gray-200 bg-gray-50 ${
              figureWidth ? "" : "max-w-2xl"
            }`}
            style={
              figureWidth ? { width: figureWidth, maxWidth: "100%" } : undefined
            }
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
              {/* Location number — bold top-LEFT overlay on the map image. */}
              {locationBadge && (
                <div className="absolute left-2 top-2 z-10">
                  <span className="rounded-md bg-white/95 px-2 py-1 text-sm font-bold text-brand-700 shadow-md ring-1 ring-black/5 backdrop-blur">
                    {locationBadge}
                  </span>
                </div>
              )}
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
            {!isAnonymized &&
              (() => {
                // Admin caption override wins over the raw filename
                // description; EN override shows flag-free on the EN site,
                // otherwise the CS text with a "Czech only" flag. Mirrors
                // the find note banner logic above.
                const ov = noteOverrides?.get(m.id);
                const capEn = ov?.en || null;
                const capCs = ov?.cs || m.description || null;
                const useEn = locale === "en" && capEn;
                const text = useEn ? capEn : capCs;
                if (!text) return null;
                return (
                  <figcaption className="border-t border-gray-200 bg-white/70 px-3 py-2 text-center text-xs text-gray-600">
                    {text}
                    {locale === "en" && !useEn && (
                      <span className="mt-1 block text-[11px] italic opacity-70">
                        {t("czechOnly")}
                      </span>
                    )}
                  </figcaption>
                );
              })()}
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
    // Center mode has no polygon — the threshold is the FIND_DEVIATION_
    // RADIUS_M circle around the map centre, so word it as a radius, not
    // a polygon edge (which doesn't exist for these locations).
    if (offset.mode === "center") {
      return t("mapStatusOutsideRadius", {
        radius: FIND_DEVIATION_RADIUS_M,
        distance: formatDistance(offset.meters, locale),
      });
    }
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
        className="select-none text-7xl font-black text-[#faf5ff] drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)] sm:text-8xl"
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
    // Ends of the collection get a personal wink with the author's little
    // smiley instead of a dead arrow: forward past the newest find says
    // "snad brzy" (more clovers coming); back before the first says
    // "#0 jen fyzicky" (clover #0 exists only in real life).
    return (
      <span
        className={`inline-flex items-center gap-1.5 whitespace-nowrap text-sm ${
          hellish ? "text-red-300/70" : "text-gray-400"
        }`}
      >
        <span aria-hidden className="text-lg leading-none opacity-60">
          🍀
        </span>
        <span>
          {direction === "next"
            ? t("nextComingSoon")
            : `#0 ${t("prevPhysicalOnly")}`}
        </span>
        {/* Author's smiley — a static public asset served by Nginx, so
            the plain <img> (no next/image optimizer) matches the rest of
            the app. Shown as-is, not clipped to a circle. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/safronus.png"
          alt="Safronus"
          width={20}
          height={20}
          className="theme-invertible h-5 w-5"
        />
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
      className={`inline-flex items-center gap-1 whitespace-nowrap font-mono text-sm ${cls}`}
    >
      {direction === "prev" && (
        <ChevronLeft className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
      )}
      <span>🍀#{id}</span>
      {direction === "next" && (
        <ChevronRight className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
      )}
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

/** Faded pipe divider between the per-location clover nav links. */
function LocNavDivider() {
  return (
    <span aria-hidden className="select-none text-gray-300">
      |
    </span>
  );
}

/** One quiet "{label} 🍀" link in the per-location find navigation —
 *  same understated style as the top-bar clover links. Renders as a
 *  faded, non-interactive span at the chain ends (`targetId === null`)
 *  or when it points at the current find's own position (`disabled`),
 *  so the row stays put across finds. */
function LocCloverLink({
  label,
  targetId,
  disabled = false,
  ariaLabel,
}: {
  label: string;
  targetId: number | null;
  disabled?: boolean;
  ariaLabel: string;
}) {
  const content = (
    <>
      {label} <span aria-hidden>🍀</span>
    </>
  );
  if (disabled || targetId === null) {
    return (
      <span
        aria-disabled
        className="inline-flex select-none items-center gap-1 whitespace-nowrap text-gray-300"
      >
        {content}
      </span>
    );
  }
  return (
    <Link
      href={`/sbirka/${targetId}`}
      aria-label={ariaLabel}
      title={ariaLabel}
      className="inline-flex items-center gap-1 whitespace-nowrap text-gray-500 transition hover:text-brand-700"
    >
      {content}
    </Link>
  );
}
