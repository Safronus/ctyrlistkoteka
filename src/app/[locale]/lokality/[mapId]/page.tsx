import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  CornerDownRight,
  ExternalLink,
  HelpCircle,
  Layers,
  ListIcon,
  MapPin,
} from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { GpsValue } from "@/components/finds/gps-value";
import {
  formatAreaM2,
  formatDateCs,
  formatDensityPer100m2,
  formatDistance,
  formatLocationId,
  formatShortDateCs,
  locationDetailHref,
} from "@/lib/format";
import {
  getAllLocationIds,
  getLocationDetailById,
  type LocationHandle,
  type LocationDetail,
  type LocationDetailFindPreview,
} from "@/lib/queries/locations";
import { countryFromCoords } from "@/lib/geo";
import { localizedCountryName } from "@/lib/world-countries";
import { RealPhotoButton } from "@/components/locations/real-photo-button";

type DetailT = Awaited<ReturnType<typeof getTranslations<"LocationDetail">>>;
type RowT = Awaited<ReturnType<typeof getTranslations<"LocationRow">>>;

interface PageProps {
  params: Promise<{ mapId: string; locale: string }>;
}

// Match FIND_REVALIDATE in src/lib/constants.ts (24 hours).
export const revalidate = 86400;

function parseMapId(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const n = parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Visual radius of the centre-dot halo on polygon-less locations.
 *  5 m is the "area attributed to a point location" hint the user
 *  asked for — small enough to read as a precise spot, big enough
 *  to actually appear on a typical street-level zoom map. */
const POLYGON_FREE_HALO_RADIUS_M = 5;
const METERS_PER_LAT_DEGREE = 111_320;

/** Overlay halo for polygon-less locations on the location detail
 *  map. Drawn as an absolutely-positioned SVG sitting on top of the
 *  PNG, with a radial gradient that fades from a soft emerald centre
 *  to fully transparent at `POLYGON_FREE_HALO_RADIUS_M`. Skips
 *  rendering when the image bounds are missing (older rows pre-sync)
 *  or when the centre falls outside the visible image rectangle —
 *  the gradient would otherwise spill into nothing useful. */
function CenterDotHalo({
  centerLat,
  centerLng,
  imageBounds,
}: {
  centerLat: number;
  centerLng: number;
  imageBounds: [[number, number], [number, number]] | null;
}) {
  if (!imageBounds) return null;
  const [[swLat, swLng], [neLat, neLng]] = imageBounds;
  const latSpan = neLat - swLat;
  const lngSpan = neLng - swLng;
  if (latSpan <= 0 || lngSpan <= 0) return null;
  // Image origin is top-left; geo origin is bottom-left → invert y.
  const xFrac = (centerLng - swLng) / lngSpan;
  const yFrac = (neLat - centerLat) / latSpan;
  if (xFrac < 0 || xFrac > 1 || yFrac < 0 || yFrac > 1) return null;

  // Pixel-radius derivation: the PNG covers `latSpan` degrees vertically;
  // multiply by metres-per-degree-latitude to get the visible height in
  // metres, then ratio against the halo radius. The result is a fraction
  // of the image's height (== width on Web Mercator at this scale within
  // a percent or two, close enough for a fuzzy halo).
  const mapHeightMeters = latSpan * METERS_PER_LAT_DEGREE;
  if (mapHeightMeters <= 0) return null;
  const rFracOfHeight = POLYGON_FREE_HALO_RADIUS_M / mapHeightMeters;
  // Cap absurdly large values (very zoomed-in maps) at 25% of the image
  // so the halo never blots out the whole PNG.
  const rFrac = Math.min(rFracOfHeight, 0.25);
  // Stable per-instance gradient id so two overlays on the same page
  // don't share fill defs (each map can have a different radius).
  const gradId = `loc-halo-${Math.round(xFrac * 10_000)}-${Math.round(yFrac * 10_000)}`;

  return (
    <svg
      aria-hidden
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      <defs>
        <radialGradient id={gradId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#10b981" stopOpacity="0.55" />
          <stop offset="55%" stopColor="#10b981" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* preserveAspectRatio="none" + a fractional viewBox lets us
       *  position the ellipse with pure 0–1 fractions on each axis,
       *  while CSS stretches the SVG to the image's bounding box.
       *  The displayed image keeps its native aspect ratio (no warp
       *  on the underlying `<img>`), so the halo lands correctly in
       *  geographic terms. */}
      <ellipse
        cx={xFrac}
        cy={yFrac}
        rx={rFrac}
        ry={rFrac}
        fill={`url(#${gradId})`}
      />
    </svg>
  );
}

export async function generateStaticParams() {
  const ids = await getAllLocationIds();
  return ids.map((id) => ({ mapId: String(id).padStart(5, "0") }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { mapId } = await params;
  const t = await getTranslations("LocationDetail");
  const id = parseMapId(mapId);
  if (id === null) return { title: t("metaNotFound") };
  const detail = await getLocationDetailById(id);
  if (!detail) return { title: t("metaNotFound") };

  if (detail.base.isAnonymized) {
    return {
      title: t("metaAnonymizedTitle", { id: formatLocationId(detail.base.id) }),
      description: t("metaAnonymizedDescription", {
        id: formatLocationId(detail.base.id),
      }),
      robots: { index: false, follow: false },
    };
  }

  const { base } = detail;
  const findCount = base.aggregateStats.total;
  const tRow = await getTranslations("LocationRow");
  const description = [
    `${formatLocationId(base.id)} – ${base.code}`,
    base.displayName && base.displayName !== base.code
      ? `(${base.displayName})`
      : null,
    findCount > 0 ? tRow("countSuffix", { count: findCount }) : null,
    base.cadastralArea ? `${base.cadastralArea}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    title: t("metaTitle", { code: base.code, id: formatLocationId(base.id) }),
    description,
    openGraph: {
      title: t("ogTitle", {
        code: base.code,
        id: formatLocationId(base.id),
      }),
      description,
      type: "article",
    },
  };
}

export default async function LocationDetailPage({ params }: PageProps) {
  const { mapId, locale } = await params;
  const id = parseMapId(mapId);
  if (id === null) notFound();

  const detail = await getLocationDetailById(id);
  if (!detail) notFound();

  const t = await getTranslations("LocationDetail");
  const tRow = await getTranslations("LocationRow");

  const { base } = detail;

  return (
    <article className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <nav
        aria-label={t("backToList")}
        className="flex flex-wrap items-center justify-between gap-3 text-sm text-gray-500"
      >
        <Link
          href="/lokality"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-gray-700 transition hover:bg-gray-100 hover:text-brand-700"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          <span>{t("backToList")}</span>
        </Link>
      </nav>

      {base.isAnonymized ? (
        <AnonymizedStub id={base.id} t={t} />
      ) : (
        <FullDetail detail={detail} t={t} tRow={tRow} locale={locale} />
      )}
    </article>
  );
}

function AnonymizedStub({ id, t }: { id: number; t: DetailT }) {
  return (
    <>
      <header className="space-y-2">
        <h1 className="flex flex-wrap items-baseline gap-x-3 text-3xl font-bold text-gray-900">
          <span className="font-mono text-base text-gray-500">
            {formatLocationId(id)}
          </span>
          {t("anonymizedH1")}
        </h1>
      </header>
      <div className="flex items-start gap-3 rounded-xl border border-purple-200 bg-purple-50 p-5 text-sm text-purple-900">
        <HelpCircle
          className="mt-0.5 h-5 w-5 shrink-0 text-purple-600"
          aria-hidden
        />
        <div className="space-y-1">
          <p className="font-medium">{t("anonymizedNoticeTitle")}</p>
          <p>{t("anonymizedNoticeBody")}</p>
        </div>
      </div>
    </>
  );
}

function FullDetail({
  detail,
  t,
  tRow,
  locale,
}: {
  detail: LocationDetail;
  t: DetailT;
  tRow: RowT;
  locale: string;
}) {
  const { base, maps, parent, siblings, children, recentFinds } = detail;
  const isChild = base.parentId !== null;
  const isLeaf = base.childCount === 0;
  const aggregate = base.aggregateStats;
  const intlLocale = locale === "cs" ? "cs-CZ" : "en-GB";
  const numFmt = new Intl.NumberFormat(intlLocale);

  return (
    <>
      <header className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-sm text-gray-500">
            {formatLocationId(base.id)}
          </span>
          <h1
            className="text-3xl font-bold text-gray-900"
            title={base.code}
          >
            {base.code}
          </h1>
          {isChild && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-700">
              <CornerDownRight className="h-3.5 w-3.5" aria-hidden />
              {t("subPartLabel")}
            </span>
          )}
          {base.childCount > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-md bg-brand-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand-800"
              title={t("subpartsTitle")}
            >
              <Layers className="h-3 w-3" aria-hidden />+{" "}
              {tRow("partsBadge", { count: base.childCount })}
            </span>
          )}
          {base.isGone && (
            <span className="rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-rose-800">
              {t("goneBadge")}
            </span>
          )}
        </div>

        {base.displayName && base.displayName !== base.code && (
          <p className="text-base text-gray-700">{base.displayName}</p>
        )}

        <p className="text-sm text-gray-500">
          {[
            base.coordinates
              ? localizedCountryName(
                  countryFromCoords(
                    base.coordinates.lat,
                    base.coordinates.lng,
                  ).name,
                  locale,
                )
              : null,
            base.cadastralArea || null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Link
          href={`/sbirka?loc=${base.id}`}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm"
        >
          <ListIcon className="h-4 w-4" aria-hidden />
          <span>
            {aggregate.total > 0
              ? t("allFindsCta", { count: numFmt.format(aggregate.total) })
              : t("allFindsEmptyCta")}
          </span>
        </Link>
        <Link
          href={`/mapa?focus=${base.id}`}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm"
        >
          <MapPin className="h-4 w-4" aria-hidden />
          <span>{t("showOnMapCta")}</span>
        </Link>
      </div>

      {maps.length > 0 && (
        <Panel
          title={t("panelMap")}
          rightSlot={(() => {
            const photoMap = maps.find((m) => m.realPhotoUrl !== null);
            if (!photoMap || !photoMap.realPhotoUrl) return undefined;
            return (
              <RealPhotoButton
                photoUrl={photoMap.realPhotoUrl}
                caption={photoMap.description ?? base.code}
              />
            );
          })()}
        >
          <div className="space-y-3">
            {maps.map((m) => (
              <figure
                key={m.id}
                className="overflow-hidden rounded-md border border-gray-200 bg-gray-50"
              >
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={m.imageUrl}
                    alt={m.description ?? t("mapImageFallback")}
                    loading="lazy"
                    decoding="async"
                    className="block h-auto w-full"
                  />
                  {/* For locations *without* an AOI polygon we have only
                   *  the centre point + the visible map PNG. Render a
                   *  tiny ~5-m gradient halo around the dot so visitors
                   *  see the approximate area attributed to this place.
                   *  Skipped when polygonAreaM2 is non-null (the PNG
                   *  itself already carries the AOI outline). */}
                  {base.polygonAreaM2 === null && (
                    <CenterDotHalo
                      centerLat={m.centerLat}
                      centerLng={m.centerLng}
                      imageBounds={m.imageBounds}
                    />
                  )}
                </div>
                {m.description && (
                  <figcaption className="px-3 py-2 text-xs text-gray-600">
                    {m.description}
                  </figcaption>
                )}
              </figure>
            ))}
          </div>
        </Panel>
      )}

      <Panel title={t("panelSummary")}>
        <SummaryGrid base={base} t={t} locale={locale} numFmt={numFmt} />
      </Panel>

      {(parent || siblings.length > 0 || children.length > 0) && (
        <Panel title={isLeaf ? t("panelRelated") : t("panelSubparts")}>
          <div className="space-y-3">
            {parent && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  {t("parentSection")}
                </p>
                <HandleRow handle={parent} t={t} />
              </div>
            )}
            {siblings.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  {t("siblingsSection", { count: siblings.length })}
                </p>
                <ul className="space-y-1">
                  {siblings.map((s) => (
                    <li key={s.id}>
                      <HandleRow handle={s} t={t} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {children.length > 0 && (
              <div className="space-y-1.5">
                {isChild && (
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    {t("subpartsSection", { count: children.length })}
                  </p>
                )}
                <ul className="space-y-1">
                  {children.map((c) => (
                    <li key={c.id}>
                      <HandleRow handle={c} t={t} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Panel>
      )}

      {recentFinds.length > 0 && (
        <Panel
          title={t("panelRecent")}
          rightSlot={
            <Link
              href={`/sbirka?loc=${base.id}`}
              className="text-xs font-medium text-brand-700 hover:underline"
            >
              {t("showAll")}
            </Link>
          }
        >
          <RecentFindsGrid
            finds={recentFinds}
            locationCode={base.code}
            locale={locale}
          />
        </Panel>
      )}
    </>
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
      {children}
    </section>
  );
}

function SummaryGrid({
  base,
  t,
  locale,
  numFmt,
}: {
  base: LocationDetail["base"];
  t: DetailT;
  locale: string;
  numFmt: Intl.NumberFormat;
}) {
  const aggregate = base.aggregateStats;
  const own = base.stats;
  const hasChildren = base.childCount > 0;
  const singleFind =
    aggregate.firstFindId !== null &&
    aggregate.lastFindId !== null &&
    aggregate.firstFindId === aggregate.lastFindId;

  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      <Field label={t("kvFindCount")}>
        <span className="font-mono text-base font-semibold text-brand-700 tabular-nums">
          {numFmt.format(aggregate.total)}
        </span>
        {hasChildren && (
          <span className="ml-2 text-xs text-gray-500">
            {t("kvFindCountSplit", {
              own: numFmt.format(own.total),
              children: numFmt.format(aggregate.total - own.total),
            })}
          </span>
        )}
      </Field>
      {!singleFind && aggregate.firstFoundAt && aggregate.lastFoundAt && (
        <Field label={t("kvDateRange")}>
          {formatDateCs(new Date(aggregate.firstFoundAt), locale)} –{" "}
          {formatDateCs(new Date(aggregate.lastFoundAt), locale)}
        </Field>
      )}
      {base.coordinates && (
        <Field label={t("kvCenterGps")}>
          <GpsValue
            lat={base.coordinates.lat}
            lng={base.coordinates.lng}
          />
        </Field>
      )}
      {base.distanceFromDefault !== null && (
        <Field label={t("kvDistanceFromDefault")}>
          <span className="font-mono tabular-nums">
            {formatDistance(base.distanceFromDefault, locale)}
          </span>
        </Field>
      )}
      {base.polygonAreaM2 !== null && (
        <Field label={t("kvPolygonArea")}>
          <span className="font-mono tabular-nums">
            {formatAreaM2(base.polygonAreaM2)}
          </span>
        </Field>
      )}
      {base.aggregateDensityPer100m2 !== null && (
        <Field label={t("kvDensity")}>
          <span className="font-mono tabular-nums">
            {formatDensityPer100m2(base.aggregateDensityPer100m2)}
          </span>
          <span className="ml-1 text-xs text-gray-500">
            {t("kvDensitySuffix")}
          </span>
        </Field>
      )}
      {singleFind ? (
        <Field label={t("kvFind")}>
          <FindRefLinks
            findId={aggregate.firstFindId!}
            foundAt={aggregate.firstFoundAt}
            t={t}
            locale={locale}
          />
        </Field>
      ) : (
        <>
          {aggregate.firstFindId !== null && (
            <Field label={t("kvFirstFind")}>
              <FindRefLinks
                findId={aggregate.firstFindId}
                foundAt={aggregate.firstFoundAt}
                t={t}
                locale={locale}
              />
            </Field>
          )}
          {aggregate.lastFindId !== null && (
            <Field label={t("kvLastFind")}>
              <FindRefLinks
                findId={aggregate.lastFindId}
                foundAt={aggregate.lastFoundAt}
                t={t}
                locale={locale}
              />
            </Field>
          )}
        </>
      )}
    </dl>
  );
}

function FindRefLinks({
  findId,
  foundAt,
  t,
  locale,
}: {
  findId: number;
  foundAt: string | null;
  t: DetailT;
  locale: string;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <Link
        href={`/sbirka/${findId}`}
        className="inline-flex items-center gap-1 font-mono text-brand-700 hover:underline"
        title={t("findDetailTitle")}
      >
        #{findId}
        <ExternalLink className="h-3 w-3" aria-hidden />
      </Link>
      {foundAt && (
        <span className="text-xs text-gray-600">
          {formatDateCs(new Date(foundAt), locale)}
        </span>
      )}
      <Link
        href={`/mapa?find=${findId}`}
        aria-label={t("showFindOnMap")}
        title={t("showFindOnMap")}
        className="inline-flex h-5 w-5 items-center justify-center rounded text-gray-400 transition hover:bg-brand-50 hover:text-brand-700"
      >
        <MapPin className="h-3.5 w-3.5" aria-hidden />
      </Link>
    </span>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-1">
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {label}
      </dt>
      <dd className="text-gray-800">{children}</dd>
    </div>
  );
}

function HandleRow({ handle, t }: { handle: LocationHandle; t: DetailT }) {
  return (
    <Link
      href={locationDetailHref(handle.id)}
      className="flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm transition hover:border-brand-200 hover:bg-brand-50"
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-xs text-gray-500">
          {formatLocationId(handle.id)}
        </span>
        <span
          className="truncate font-semibold text-gray-800"
          title={handle.code}
        >
          {handle.code}
        </span>
        {handle.displayName && handle.displayName !== handle.code && (
          <span
            className="truncate text-gray-500"
            title={handle.displayName}
          >
            ({handle.displayName})
          </span>
        )}
        {handle.isGone && (
          <span className="rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-rose-800">
            {t("goneBadge")}
          </span>
        )}
      </div>
      <span className="shrink-0 text-xs text-gray-500">
        {t("partsCountInline", { count: handle.findCount })}
      </span>
    </Link>
  );
}

async function RecentFindsGrid({
  finds,
  locationCode,
  locale,
}: {
  finds: readonly LocationDetailFindPreview[];
  locationCode: string;
  locale: string;
}) {
  const tRow = await getTranslations("FindRow");
  return (
    <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
      {finds.map((f) => {
        const altText = f.isAnonymized
          ? tRow("anonymizedAlt", { id: f.id })
          : `${tRow("findAlt", { id: f.id })} – ${locationCode}`;
        return (
          <li key={f.id}>
            <Link
              href={`/sbirka/${f.id}`}
              className="group block overflow-hidden rounded-md border border-gray-200 bg-white transition hover:border-brand-200 hover:shadow-sm"
            >
              <div className="relative aspect-square w-full overflow-hidden bg-gradient-to-br from-brand-50 to-brand-100">
                {f.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={f.thumbUrl}
                    alt={altText}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div
                    aria-hidden
                    className="absolute inset-0 flex items-center justify-center text-3xl opacity-40"
                  >
                    🍀
                  </div>
                )}
              </div>
              <div className="px-2 py-1.5 text-xs">
                <span className="font-mono font-semibold text-gray-800 group-hover:text-brand-700">
                  #{f.id}
                </span>
                {f.foundAt && (
                  <span className="ml-1.5 text-gray-500">
                    {formatShortDateCs(f.foundAt, locale)}
                  </span>
                )}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
