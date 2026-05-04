import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MapPin } from "lucide-react";
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
import {
  formatDateTimeCs,
  formatDistance,
  formatLocationId,
  formatLocationOffset,
  locationOffsetToneClass,
} from "@/lib/format";
import { isFormerLocation } from "@/lib/locationCode";
import {
  getAdjacentFindIds,
  getAllFindIds,
  getFindById,
  type PublicLocationMap,
} from "@/lib/queries/finds";

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
  const detail = (
    <article className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
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
          {find.states.length > 0 && <StateBadges states={find.states} />}
        </div>

        {/* Meta row: datetime on the left, GPS + distance on the right.
            Distance trails the GPS pair so the eye keeps the cardinal
            "how far from home" number adjacent to the absolute coords. */}
        <div
          className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm ${
            hellish ? "text-red-200/90" : "text-gray-600"
          }`}
        >
          <span>{formatDateTimeCs(find.foundAt, locale)}</span>
          {!find.isAnonymized && find.coordinates && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <GpsValue
                lat={find.coordinates.lat}
                lng={find.coordinates.lng}
                tone={hellish ? "dark" : "default"}
              />
              {find.locationOffset && (
                <span
                  className={`text-xs ${
                    hellish ? "text-red-300/80" : "text-gray-500"
                  }`}
                  title={
                    find.locationOffset.mode === "polygon"
                      ? t("offsetTitlePolygon")
                      : t("offsetTitleCenter")
                  }
                >
                  <span
                    className={`font-mono tabular-nums ${
                      hellish
                        ? "text-red-100"
                        : locationOffsetToneClass(find.locationOffset)
                    }`}
                  >
                    {formatLocationOffset(find.locationOffset, locale)}
                  </span>
                </span>
              )}
              {find.distanceFromDefault !== null && (
                <span
                  className={`text-xs ${
                    hellish ? "text-red-300/80" : "text-gray-500"
                  }`}
                  title={t("distanceTitle")}
                >
                  <span
                    className={`font-mono tabular-nums ${
                      hellish ? "text-red-100" : "text-gray-800"
                    }`}
                  >
                    {formatDistance(find.distanceFromDefault, locale)}
                  </span>{" "}
                  {t("distanceFromMap")}
                </span>
              )}
            </div>
          )}
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

      <ImageGallery
        image={mainImage}
        cropImage={cropImage}
        altBase={t("imageAlt", { id: find.id })}
        findId={find.id}
        donationPhotos={find.donationPhotos}
      />

      {find.isAnonymized && (
        <p className="rounded-md border border-purple-200 bg-purple-50 p-3 text-sm text-purple-900">
          {t("anonymizedNotice")}
        </p>
      )}

      <Panel
        title={t("panelLocation")}
        rightSlot={
          find.location && (
            <span className="font-mono text-xs text-gray-500">
              {formatLocationId(find.location.id)}
            </span>
          )
        }
      >
        {find.isAnonymized && (
          <p className="rounded-md border border-purple-200 bg-purple-50 p-3 text-sm text-purple-900">
            {t("anonymizedLocationNotice", {
              placeholderId: find.location
                ? formatLocationId(find.location.id)
                : "",
            })}
          </p>
        )}
        {!find.isAnonymized && isFormerLocation(find.location?.code) && (
          <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
            {t("formerLocationNotice")}
          </p>
        )}
        {find.location ? (
          <>
            <KeyValue label={t("kvCode")} value={find.location.code} />
            <KeyValue label={t("kvDescription")} value={find.location.displayName} />
            {/* Map deep-link mirrors the row-level icon in /sbirka:
                `?find=N` highlights the specific find on the canvas
                (single marker + auto-fit). Only public finds with GPS
                qualify — anonymized ones never expose a position, so
                the button is hidden for them. The location-only
                fallback (`?focus=`) was confusing: visitors arriving
                from the detail expected to see THIS find, not the
                whole location dot soup. */}
            {!find.isAnonymized && find.coordinates && (
              <div className="pt-1">
                <Link
                  href={`/mapa?find=${find.id}`}
                  className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm"
                >
                  <MapPin className="h-3.5 w-3.5" aria-hidden />
                  <span>{t("showOnMap")}</span>
                </Link>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-gray-600">{t("noLocation")}</p>
        )}
        {find.locationMaps.length > 0 && (
          <LocationMapsGallery
            maps={find.locationMaps}
            isAnonymized={find.isAnonymized}
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

function LocationMapsGallery({
  maps,
  isAnonymized = false,
  t,
}: {
  maps: readonly PublicLocationMap[];
  /** Anonymized finds get a `?` overlay on the placeholder map so a
   *  visitor can't mistake the substituted default location for the
   *  real one. The query layer already strips the marker (`no-gps`)
   *  and swaps in the placeholder location; this is the visual seal. */
  isAnonymized?: boolean;
  /** Server-side translator pre-bound to the `FindDetail` namespace.
   *  Passed as a prop instead of re-derived here so the helper stays
   *  a sync function (next-intl's `getTranslations` is async). */
  t: FindDetailT;
}) {
  return (
    <div className="space-y-3 pt-2">
      {maps.map((m) => (
        <figure
          key={m.id}
          className="overflow-hidden rounded-md border border-gray-200 bg-gray-50"
        >
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
            {!isAnonymized && m.marker?.kind === "inside" && (
              <FindLocationMarker
                xFrac={m.marker.xFrac}
                yFrac={m.marker.yFrac}
                t={t}
              />
            )}
            {isAnonymized && <AnonymizedMapOverlay t={t} />}
          </div>
          {m.description && !isAnonymized && (
            <figcaption className="px-3 pt-2 text-xs text-gray-600">
              {m.description}
            </figcaption>
          )}
          {!isAnonymized && m.marker?.kind === "outside" && (
            <p className="px-3 pb-2 pt-1 text-xs text-gray-500">
              {t("mapMarkerOutside")}
            </p>
          )}
          {!isAnonymized && m.marker?.kind === "no-gps" && (
            <p className="px-3 pb-2 pt-1 text-xs text-gray-500">
              {t("mapMarkerNoGps")}
            </p>
          )}
        </figure>
      ))}
    </div>
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
 *  guarantees visibility on grass / pavement / dark roof alike. */
function FindLocationMarker({
  xFrac,
  yFrac,
  t,
}: {
  xFrac: number;
  yFrac: number;
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
        filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.45))",
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

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-xs font-medium text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-800">{value}</dd>
    </div>
  );
}
