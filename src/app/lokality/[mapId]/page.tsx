import type { Metadata } from "next";
import Link from "next/link";
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
import { GpsValue } from "@/components/finds/gps-value";
import {
  formatAreaM2,
  formatDateCs,
  formatDateTimeCs,
  formatDensityPer100m2,
  formatDistance,
  formatLocationId,
  locationDetailHref,
  pluralCs,
  FINDS,
} from "@/lib/format";
import {
  getAllLocationIds,
  getLocationDetailById,
  type LocationHandle,
  type LocationDetail,
  type LocationDetailFindPreview,
} from "@/lib/queries/locations";

interface PageProps {
  params: Promise<{ mapId: string }>;
}

// Match FIND_REVALIDATE in src/lib/constants.ts (24 hours).
export const revalidate = 86400;

/** Parse "00001" → 1. Accepts any leading-zero count for tolerance,
 *  but the canonical link form is always five digits. Returns null
 *  on anything that isn't a positive integer. */
function parseMapId(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const n = parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function generateStaticParams() {
  const ids = await getAllLocationIds();
  return ids.map((id) => ({ mapId: String(id).padStart(5, "0") }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { mapId } = await params;
  const id = parseMapId(mapId);
  if (id === null) return { title: "Nenalezeno" };
  const detail = await getLocationDetailById(id);
  if (!detail) return { title: "Nenalezeno" };

  // Anonymized: minimal metadata + noindex. The detail body renders a
  // stub but the page still needs valid <title> for browsers/feed
  // readers; we just don't expose code/displayName.
  if (detail.base.isAnonymized) {
    return {
      title: `Lokalita ${formatLocationId(detail.base.id)}`,
      description: `Anonymizovaná lokalita ${formatLocationId(detail.base.id)}.`,
      robots: { index: false, follow: false },
    };
  }

  const { base } = detail;
  const findCount = base.aggregateStats.total;
  const description = [
    `Lokalita ${formatLocationId(base.id)} – ${base.code}`,
    base.displayName && base.displayName !== base.code
      ? `(${base.displayName})`
      : null,
    findCount > 0 ? `${findCount} ${pluralCs(findCount, FINDS)}` : null,
    base.cadastralArea ? `${base.cadastralArea}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    title: `${base.code} – ${formatLocationId(base.id)}`,
    description,
    openGraph: {
      title: `${base.code} – lokalita ${formatLocationId(base.id)}`,
      description,
      type: "article",
    },
  };
}

export default async function LocationDetailPage({ params }: PageProps) {
  const { mapId } = await params;
  const id = parseMapId(mapId);
  if (id === null) notFound();

  const detail = await getLocationDetailById(id);
  if (!detail) notFound();

  const { base } = detail;

  return (
    <article className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <nav
        aria-label="Zpět na seznam lokalit"
        className="flex flex-wrap items-center justify-between gap-3 text-sm text-gray-500"
      >
        <Link
          href="/lokality"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-gray-700 transition hover:bg-gray-100 hover:text-brand-700"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          <span>Zpět na seznam lokalit</span>
        </Link>
      </nav>

      {base.isAnonymized ? (
        <AnonymizedStub id={base.id} />
      ) : (
        <FullDetail detail={detail} />
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
//  Anonymized stub
// ---------------------------------------------------------------------------

function AnonymizedStub({ id }: { id: number }) {
  return (
    <>
      <header className="space-y-2">
        <h1 className="flex flex-wrap items-baseline gap-x-3 text-3xl font-bold text-gray-900">
          <span className="font-mono text-base text-gray-500">
            {formatLocationId(id)}
          </span>
          Anonymizovaná lokalita
        </h1>
      </header>
      <div className="flex items-start gap-3 rounded-xl border border-purple-200 bg-purple-50 p-5 text-sm text-purple-900">
        <HelpCircle
          className="mt-0.5 h-5 w-5 shrink-0 text-purple-600"
          aria-hidden
        />
        <div className="space-y-1">
          <p className="font-medium">Detail této lokality se nezobrazuje</p>
          <p>
            Lokalita je anonymizovaná. Její kód, popis ani polohu nelze na
            veřejném webu vystavit.
          </p>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
//  Full detail
// ---------------------------------------------------------------------------

function FullDetail({ detail }: { detail: LocationDetail }) {
  const { base, maps, parent, siblings, children, recentFinds } = detail;
  const isChild = base.parentId !== null;
  const isLeaf = base.childCount === 0;
  const aggregate = base.aggregateStats;

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
              dílčí část
            </span>
          )}
          {base.childCount > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-md bg-brand-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand-800"
              title="Lokalita je rozdělena na dílčí části"
            >
              <Layers className="h-3 w-3" aria-hidden />+ {base.childCount}{" "}
              {base.childCount === 1
                ? "část"
                : base.childCount < 5
                  ? "části"
                  : "částí"}
            </span>
          )}
          {base.isGone && (
            <span className="rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-rose-800">
              Zaniklá
            </span>
          )}
        </div>

        {base.displayName && base.displayName !== base.code && (
          <p className="text-base text-gray-700">{base.displayName}</p>
        )}

        <p className="text-sm text-gray-500">
          {base.cadastralArea}
          {base.locationType ? ` · ${base.locationType}` : ""}
        </p>
      </header>

      {/* Header CTAs — same shape as the home cards: full-width on
          narrow viewports, side-by-side from sm. /sbirka folds parent
          into children automatically. */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Link
          href={`/sbirka?loc=${base.id}`}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm"
        >
          <ListIcon className="h-4 w-4" aria-hidden />
          <span>
            {aggregate.total > 0
              ? `Všechny nálezy (${aggregate.total.toLocaleString("cs-CZ")})`
              : "Všechny nálezy"}
          </span>
        </Link>
        <Link
          href={`/mapa?focus=${base.id}`}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm"
        >
          <MapPin className="h-4 w-4" aria-hidden />
          <span>Zobrazit na mapě</span>
        </Link>
      </div>

      {/* Maps gallery (PNG overlays from EXIF metadata). One figure per
          map, no find-specific pin — this is just the location for
          context. Anonymized maps are filtered out upstream. */}
      {maps.length > 0 && (
        <Panel title="Mapa lokality">
          <div className="space-y-3">
            {maps.map((m) => (
              <figure
                key={m.id}
                className="overflow-hidden rounded-md border border-gray-200 bg-gray-50"
              >
                {/* Served by Nginx. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={m.imageUrl}
                  alt={m.description ?? "Mapa lokality"}
                  loading="lazy"
                  decoding="async"
                  className="block h-auto w-full"
                />
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

      <Panel title="Souhrn">
        <SummaryGrid base={base} />
      </Panel>

      {(parent || siblings.length > 0 || children.length > 0) && (
        <Panel title={isLeaf ? "Související lokality" : "Dílčí části"}>
          <div className="space-y-3">
            {parent && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Nadřazená lokalita
                </p>
                <HandleRow handle={parent} />
              </div>
            )}
            {siblings.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Sourozenecké části ({siblings.length})
                </p>
                <ul className="space-y-1">
                  {siblings.map((s) => (
                    <li key={s.id}>
                      <HandleRow handle={s} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {children.length > 0 && (
              <div className="space-y-1.5">
                {/* When the current node is a master, the panel title
                    "Dílčí části" already names this section — render the
                    children list bare to avoid the duplicate header. */}
                {isChild && (
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    Dílčí části ({children.length})
                  </p>
                )}
                <ul className="space-y-1">
                  {children.map((c) => (
                    <li key={c.id}>
                      <HandleRow handle={c} />
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
          title="Nedávné nálezy"
          rightSlot={
            <Link
              href={`/sbirka?loc=${base.id}`}
              className="text-xs font-medium text-brand-700 hover:underline"
            >
              Vše →
            </Link>
          }
        >
          <RecentFindsGrid finds={recentFinds} locationCode={base.code} />
        </Panel>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
//  Sub-components
// ---------------------------------------------------------------------------

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
}: {
  base: LocationDetail["base"];
}) {
  const aggregate = base.aggregateStats;
  const own = base.stats;
  const hasChildren = base.childCount > 0;
  // Single-find lokalities have firstFindId === lastFindId (or just one of
  // them set). Merge the two slots into one "Nález" field so the panel
  // doesn't repeat the same row twice with the same date.
  const singleFind =
    aggregate.firstFindId !== null &&
    aggregate.lastFindId !== null &&
    aggregate.firstFindId === aggregate.lastFindId;

  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      <Field label="Počet nálezů">
        <span className="font-mono text-base font-semibold text-brand-700 tabular-nums">
          {aggregate.total.toLocaleString("cs-CZ")}
        </span>
        {hasChildren && own.total !== aggregate.total && (
          <span className="ml-2 text-xs text-gray-500">
            (vlastních {own.total.toLocaleString("cs-CZ")} + dílčí části)
          </span>
        )}
      </Field>
      {!singleFind && aggregate.firstFoundAt && aggregate.lastFoundAt && (
        <Field label="Časový rozsah">
          {formatDateCs(new Date(aggregate.firstFoundAt))} –{" "}
          {formatDateCs(new Date(aggregate.lastFoundAt))}
        </Field>
      )}
      {base.coordinates && (
        <Field label="GPS středu">
          <GpsValue
            lat={base.coordinates.lat}
            lng={base.coordinates.lng}
          />
        </Field>
      )}
      {base.distanceFromDefault !== null && (
        <Field label="Vzdálenost od mapy #00001">
          <span className="font-mono tabular-nums">
            {formatDistance(base.distanceFromDefault)}
          </span>
        </Field>
      )}
      {base.polygonAreaM2 !== null && (
        <Field label="Plocha polygonu">
          <span className="font-mono tabular-nums">
            {formatAreaM2(base.polygonAreaM2)}
          </span>
        </Field>
      )}
      {base.densityPer100m2 !== null && (
        <Field label="Hustota nálezů">
          <span className="font-mono tabular-nums">
            {formatDensityPer100m2(base.densityPer100m2)}
          </span>
          <span className="ml-1 text-xs text-gray-500">
            (vlastních / 100 m²)
          </span>
        </Field>
      )}
      {singleFind ? (
        <Field label="Nález">
          <FindRefLinks
            findId={aggregate.firstFindId!}
            foundAt={aggregate.firstFoundAt}
          />
        </Field>
      ) : (
        <>
          {aggregate.firstFindId !== null && (
            <Field label="První nález">
              <FindRefLinks
                findId={aggregate.firstFindId}
                foundAt={aggregate.firstFoundAt}
              />
            </Field>
          )}
          {aggregate.lastFindId !== null && (
            <Field label="Poslední nález">
              <FindRefLinks
                findId={aggregate.lastFindId}
                foundAt={aggregate.lastFoundAt}
              />
            </Field>
          )}
        </>
      )}
    </dl>
  );
}

/** First/last find reference: ID + optional date as a /sbirka deep-link
 *  plus a small map-pin shortcut to /mapa?find=N. Same shape used in
 *  both single-find ("Nález") and range ("První nález" / "Poslední
 *  nález") slots so the visual is consistent. */
function FindRefLinks({
  findId,
  foundAt,
}: {
  findId: number;
  foundAt: string | null;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <Link
        href={`/sbirka/${findId}`}
        className="inline-flex items-center gap-1 font-mono text-brand-700 hover:underline"
        title="Detail nálezu"
      >
        #{findId}
        <ExternalLink className="h-3 w-3" aria-hidden />
      </Link>
      {foundAt && (
        <span className="text-xs text-gray-600">
          {formatDateCs(new Date(foundAt))}
        </span>
      )}
      <Link
        href={`/mapa?find=${findId}`}
        aria-label="Zobrazit nález na mapě"
        title="Zobrazit nález na mapě"
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
    <div className="flex items-baseline justify-between gap-3 sm:flex-col sm:items-start sm:gap-1">
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {label}
      </dt>
      <dd className="text-gray-800">{children}</dd>
    </div>
  );
}

function HandleRow({ handle }: { handle: LocationHandle }) {
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
            Zaniklá
          </span>
        )}
      </div>
      <span className="shrink-0 text-xs text-gray-500">
        {handle.findCount.toLocaleString("cs-CZ")}{" "}
        {pluralCs(handle.findCount, FINDS)}
      </span>
    </Link>
  );
}

function RecentFindsGrid({
  finds,
  locationCode,
}: {
  finds: readonly LocationDetailFindPreview[];
  locationCode: string;
}) {
  return (
    <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
      {finds.map((f) => {
        const altText = f.isAnonymized
          ? `Anonymizovaný nález #${f.id}`
          : `Nález #${f.id} – ${locationCode}`;
        return (
          <li key={f.id}>
            <Link
              href={`/sbirka/${f.id}`}
              className="group block overflow-hidden rounded-md border border-gray-200 bg-white transition hover:border-brand-200 hover:shadow-sm"
            >
              <div className="relative aspect-square w-full overflow-hidden bg-gradient-to-br from-brand-50 to-brand-100">
                {f.thumbUrl ? (
                  // Served by Nginx, no Next.js optimizer.
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
                    {formatDateTimeCs(f.foundAt).split(",")[0]}
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
