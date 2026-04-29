import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MapPin } from "lucide-react";
import { ImageType } from "@prisma/client";
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
} from "@/lib/format";
import { isFormerLocation } from "@/lib/locationCode";
import {
  getAdjacentFindIds,
  getAllFindIds,
  getFindById,
  type PublicLocationMap,
} from "@/lib/queries/finds";

interface PageProps {
  params: Promise<{ id: string }>;
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
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) {
    return { title: "Nenalezeno" };
  }
  const find = await getFindById(numId);
  if (!find) {
    return { title: "Nenalezeno" };
  }
  // Anonymized finds must not be indexed and must not leak data in meta tags.
  if (find.isAnonymized) {
    return {
      title: `Nález #${find.id}`,
      description: `Anonymizovaný nález #${find.id}.`,
      robots: { index: false, follow: false },
    };
  }
  const locationName =
    find.location?.displayName ?? find.location?.code ?? "bez lokality";
  const title = `Nález #${find.id} – ${locationName}`;
  const description = `Čtyřlístkový nález, lokalita ${locationName}.`;
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
  const { id } = await params;
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
  const mainImage =
    find.images.find((i) => i.imageType === ImageType.ORIGINAL) ??
    find.images[0] ??
    null;
  const cropImage =
    find.images.find((i) => i.imageType === ImageType.CROP) ?? null;

  // #111 and #666 get special atmospheric overlays — see CLAUDE.md /
  // detail-vibe-overlay.tsx for the contract. Everything else renders
  // unchanged. The overlay is full-viewport `position: fixed` so it
  // sits on top of the article without affecting layout.
  const hellish = isHellishFind(find.id);
  const detail = (
    <article className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <nav
        aria-label="Navigace mezi nálezy"
        className={`flex flex-wrap items-center justify-between gap-3 text-sm ${
          hellish ? "text-red-300/80" : "text-gray-500"
        }`}
      >
        <BackToSbirkaLink />
        <div className="flex items-center gap-3">
          <AdjacentLink direction="prev" id={adjacent.prevId} hellish={hellish} />
          <AdjacentLink direction="next" id={adjacent.nextId} hellish={hellish} />
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
            Nález #{find.id}
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
          <span>{formatDateTimeCs(find.foundAt)}</span>
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
                      ? "Vzdušná vzdálenost od hrany polygonu lokace (0 = uvnitř AOI)"
                      : "Vzdušná vzdálenost od GPS středu lokační mapy"
                  }
                >
                  <span
                    className={`font-mono tabular-nums ${
                      hellish ? "text-red-100" : "text-gray-800"
                    }`}
                  >
                    {formatLocationOffset(find.locationOffset)}
                  </span>
                </span>
              )}
              {find.distanceFromDefault !== null && (
                <span
                  className={`text-xs ${
                    hellish ? "text-red-300/80" : "text-gray-500"
                  }`}
                  title="Vzdušná vzdálenost od GPS středu lokační mapy 00001"
                >
                  <span
                    className={`font-mono tabular-nums ${
                      hellish ? "text-red-100" : "text-gray-800"
                    }`}
                  >
                    {formatDistance(find.distanceFromDefault)}
                  </span>{" "}
                  od MAP 00001
                </span>
              )}
            </div>
          )}
        </div>

        {!find.isAnonymized && find.notes && (
          <p className="whitespace-pre-wrap rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800">
            {find.notes}
          </p>
        )}
      </header>

      <ImageGallery
        image={mainImage}
        cropImage={cropImage}
        altBase={`Nález #${find.id}`}
      />

      {find.isAnonymized && (
        <p className="rounded-md border border-purple-200 bg-purple-50 p-3 text-sm text-purple-900">
          Tento nález je anonymizovaný — souřadnice, poznámka ani konkrétní
          lokalita se na veřejném webu nezobrazují.
        </p>
      )}

      <Panel
        title="Lokalita"
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
            Skutečná lokalita anonymizovaného nálezu se nezobrazuje. Místo
            ní vidíš výchozí lokalitu{" "}
            {find.location ? formatLocationId(find.location.id) : ""}.
          </p>
        )}
        {!find.isAnonymized && isFormerLocation(find.location?.code) && (
          <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
            Tato lokalita už fyzicky neexistuje (zástavba, terénní úprava
            apod.). Mapa zobrazuje původní místo.
          </p>
        )}
        {find.location ? (
          <>
            <KeyValue label="Kód lokality" value={find.location.code} />
            <KeyValue label="Popis lokality" value={find.location.displayName} />
            {/* Anonymized rows still get a link — the location row already
                acknowledges its existence above; the map page focuses on
                the *default* location for anonymized finds (per
                find.location.id, which is overridden server-side), so we
                don't leak anything we wouldn't already show. */}
            <div className="pt-1">
              <Link
                href={`/mapa?focus=${find.location.id}`}
                className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm"
              >
                <MapPin className="h-3.5 w-3.5" aria-hidden />
                <span>Zobrazit na mapě</span>
              </Link>
            </div>
          </>
        ) : (
          <p className="text-sm text-gray-600">
            Lokalita není k tomuto nálezu přiřazena.
          </p>
        )}
        {find.locationMaps.length > 0 && (
          <LocationMapsGallery maps={find.locationMaps} />
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

function LocationMapsGallery({ maps }: { maps: readonly PublicLocationMap[] }) {
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
              alt={m.description ?? "Mapa lokality"}
              loading="lazy"
              decoding="async"
              className="block h-auto w-full"
            />
            {m.marker?.kind === "inside" && (
              <FindLocationMarker
                xFrac={m.marker.xFrac}
                yFrac={m.marker.yFrac}
              />
            )}
          </div>
          {m.description && (
            <figcaption className="px-3 pt-2 text-xs text-gray-600">
              {m.description}
            </figcaption>
          )}
          {m.marker?.kind === "outside" && (
            <p className="px-3 pb-2 pt-1 text-xs text-gray-500">
              GPS nálezu leží mimo zachycenou plochu této lokační mapy.
            </p>
          )}
          {m.marker?.kind === "no-gps" && (
            <p className="px-3 pb-2 pt-1 text-xs text-gray-500">
              Nález nemá zaznamenané GPS souřadnice — pozici nelze na mapu
              vykreslit.
            </p>
          )}
        </figure>
      ))}
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
}: {
  xFrac: number;
  yFrac: number;
}) {
  return (
    <span
      role="img"
      aria-label="Pozice nálezu na mapě"
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
}: {
  direction: "prev" | "next";
  id: number | null;
  /** When the surrounding page is the hellish #666 variant, the chip
   *  needs red/light colours to stay readable on the dark gradient. */
  hellish?: boolean;
}) {
  const label =
    direction === "prev" ? `← Předchozí #${id}` : `Další #${id} →`;
  const placeholder = direction === "prev" ? "← Předchozí" : "Další →";
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
