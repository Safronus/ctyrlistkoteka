import { getLocale, getTranslations } from "next-intl/server";
import { COLLECTION_TIME_ZONE } from "@/lib/collectionTime";
import { FindState } from "@/generated/prisma/enums";
import { Camera, Images, MapPin, Trophy } from "lucide-react";
import { Link } from "@/i18n/navigation";
import type { PublicFind } from "@/lib/queries/finds";
import { FindThumbnail, cropVariant } from "./find-thumbnail";
import { StateBadges } from "./state-badges";
import { VoteButton } from "./vote-button";
import { formatDistance, formatShortDateTimeCs } from "@/lib/format";
import { formatGpsApple } from "@/lib/gpsFormat";
import { formatLocationId } from "@/lib/format";
import { UNKNOWN_LOCATION_ID } from "@/lib/constants";

type OffsetT = Awaited<ReturnType<typeof getTranslations<"LocationOffset">>>;
type CompassT = Awaited<ReturnType<typeof getTranslations<"Compass">>>;

export async function FindCard({
  find,
  voted,
  voteCount,
  priority = false,
  autoHydrate = false,
}: {
  find: PublicFind;
  voted: boolean;
  voteCount: number;
  /** Eager-load this card's thumbnail (first grid row) to fix the LCP. */
  priority?: boolean;
  /** Forwarded to VoteButton: self-hydrate the voted state on mount when
   *  the host page is ISR-cached (e.g. the location detail page's recent
   *  finds). Off for dynamic pages that pass an accurate initial state. */
  autoHydrate?: boolean;
}) {
  const locale = await getLocale();
  const [tRow, tOffset, tCompass] = await Promise.all([
    getTranslations("FindRow"),
    getTranslations("LocationOffset"),
    getTranslations("Compass"),
  ]);

  const altText = find.isAnonymized
    ? tRow("anonymizedAlt", { id: find.id })
    : tRow("findAlt", { id: find.id });

  // Same gate as the /sbirka list row's map-pin: only finds with a real
  // (non-anonymized) coordinate can be pointed at on the map — and finds
  // parked on NEZNÁMÁ (00000) aren't plotted at all, so the pin would lead
  // nowhere.
  const showMapLink =
    !find.isAnonymized &&
    find.location?.id !== UNKNOWN_LOCATION_ID &&
    find.coordinates !== null;

  return (
    <div className="group overflow-hidden rounded-lg border border-gray-200 bg-white transition hover:border-brand-200 hover:shadow-sm">
      {/* Banner above the photo: map-pin (left) · "🍀 #123" (centre) ·
          vote (right). The pin and the vote button are SIBLINGS of the
          detail links below — never nested inside an <a> — so the markup
          stays valid and each control keeps its own click target. When a
          side control is absent, a same-size spacer holds the number
          roughly centred. */}
      <div className="flex items-center justify-between gap-0.5 px-1.5 py-1.5">
        {/* Left — map-pin deep-link to /mapa (or spacer). */}
        {showMapLink ? (
          <Link
            href={`/mapa?find=${find.id}`}
            className="inline-flex shrink-0 items-center justify-center rounded-md p-1.5 text-gray-500 transition hover:bg-brand-100 hover:text-brand-700 focus:bg-brand-100 focus:text-brand-700 focus:outline-none"
            aria-label={tRow("showOnMap")}
            title={tRow("showOnMap")}
          >
            <MapPin className="h-4 w-4" aria-hidden />
          </Link>
        ) : (
          <span aria-hidden className="h-7 w-7 shrink-0" />
        )}

        {/* Centre — the find number links to the detail page. */}
        <Link
          href={`/sbirka/${find.id}`}
          className="flex min-w-0 flex-1 items-center justify-center gap-1"
        >
          <span className="truncate text-xs font-semibold text-gray-900 group-hover:text-brand-700 sm:text-sm">
            🍀 #{find.id}
          </span>
          {find.isRecord && (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700"
              title={tRow("recordBadgeTitle")}
            >
              <Trophy className="h-3 w-3" aria-hidden />
              {tRow("recordBadge")}
            </span>
          )}
        </Link>

        {/* Right — vote pill (or spacer). Only when a thumbnail exists
            (no-photo finds have nothing to vote on). */}
        {find.primaryImage ? (
          <div className="shrink-0">
            <VoteButton
              findId={find.id}
              initialVoted={voted}
              initialCount={voteCount}
              autoHydrate={autoHydrate}
            />
          </div>
        ) : (
          <span aria-hidden className="h-7 w-7 shrink-0" />
        )}
      </div>

      <Link href={`/sbirka/${find.id}`} className="relative block">
        {/* LOST finds render their photo in grayscale — the quiet
            list-level echo of the detail page's elegy treatment. The
            overlays are siblings, so they keep their colours. */}
        <FindThumbnail
          image={
            cropVariant(find.primaryImage, find.images) ?? find.primaryImage
          }
          alt={altText}
          priority={priority}
          className={`aspect-square ${
            find.states.includes(FindState.LOST) ? "grayscale" : ""
          }`}
        />
        {/* State badges — top-left. */}
        {find.states.length > 0 && (
          <div className="pointer-events-none absolute inset-x-2 top-2">
            <StateBadges states={find.states} className="drop-shadow-sm" />
          </div>
        )}
        {/* Date + time — bottom overlay, centred, over a strong gradient +
            text-shadow so it stays legible on any photo (incl. bright /
            grayscale ones). Both are inline styles on purpose: Tailwind's
            arbitrary text-shadow value didn't reliably compile. */}
        {find.foundAt && (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 px-2 pb-2 pt-10"
            style={{
              background:
                "linear-gradient(to top, rgba(0,0,0,0.92), rgba(0,0,0,0.6) 45%, transparent)",
            }}
          >
            <p
              className="text-center text-xs font-semibold tracking-tight"
              style={{
                // Literal light clover-green (not a Tailwind class): the dark
                // theme inverts colour classes, which flipped `text-white` to
                // black — but the gradient below is a fixed literal dark, so
                // the text must be a fixed light colour in both themes.
                color: "#bbf7d0",
                textShadow:
                  "0 1px 4px rgba(0,0,0,0.95), 0 0 3px rgba(0,0,0,0.85)",
              }}
            >
              {formatShortDateTimeCs(
                find.foundAt,
                locale,
                COLLECTION_TIME_ZONE,
              )}
            </p>
          </div>
        )}
        {/* Photo-availability chips — bottom-right, over the gradient. */}
        {(find.hasRealPhoto || find.hasFreePhoto) && (
          <div className="pointer-events-none absolute bottom-1.5 right-1.5 flex items-center gap-1">
            {find.hasRealPhoto && (
              <span
                className="inline-flex items-center rounded-md bg-emerald-100 px-1 py-0.5 text-emerald-800 drop-shadow-sm"
                title={tRow("donationPhotoTitle")}
                aria-label={tRow("donationPhotoTitle")}
              >
                <Camera className="h-3 w-3" aria-hidden />
              </span>
            )}
            {find.hasFreePhoto && (
              <span
                className="inline-flex items-center rounded-md bg-sky-100 px-1 py-0.5 text-sky-800 drop-shadow-sm"
                title={tRow("freePhotoTitle")}
                aria-label={tRow("freePhotoTitle")}
              >
                <Images className="h-3 w-3" aria-hidden />
              </span>
            )}
          </div>
        )}
        <FindHoverInfo
          find={find}
          locale={locale}
          tOffset={tOffset}
          tCompass={tCompass}
        />
      </Link>
    </div>
  );
}

/**
 * Slide-up detail strip along the bottom of the tile's photo, revealed on
 * hover (and on keyboard focus, so it isn't mouse-only).
 *
 * Pure CSS off the card's `group` class — no client component and no hover
 * state to hydrate, which matters on a page that renders a hundred of these.
 * `pointer-events-none` keeps the whole tile a single click target.
 *
 * Anonymized finds get nothing: their coordinates and distance are already
 * null by policy, and the location identity is exactly what anonymization
 * withholds.
 */
function FindHoverInfo({
  find,
  locale,
  tOffset,
  tCompass,
}: {
  find: PublicFind;
  locale: string;
  tOffset: OffsetT;
  tCompass: CompassT;
}) {
  if (find.isAnonymized) return null;
  const loc = find.location;
  const hasDistance = find.distanceFromDefault !== null;
  if (!loc && !find.coordinates && !hasDistance) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-full bg-black/85 px-2 py-1.5 transition-transform duration-150 ease-out group-hover:translate-y-0 group-focus-within:translate-y-0"
    >
      {loc && (
        <p
          className={`truncate text-center font-mono leading-tight ${codeSizeClass(loc.code)}`}
          style={{ color: "#e5e7eb" }}
          title={loc.code}
        >
          <span style={{ color: "#9ca3af" }}>{formatLocationId(loc.id)}</span>{" "}
          {loc.code}
        </p>
      )}
      {find.coordinates && (
        <p
          className="truncate text-center font-mono text-[10px] leading-tight"
          style={{ color: "#bbf7d0" }}
        >
          {formatGpsApple(find.coordinates.lat, find.coordinates.lng, locale)}
        </p>
      )}
      {hasDistance && (
        <p
          className="truncate text-center text-[10px] leading-tight"
          style={{ color: "#d1d5db" }}
        >
          {tOffset("fromDefaultMap", {
            distance: formatDistance(find.distanceFromDefault!, locale),
          })}
          {find.directionFromDefault !== null && (
            <> · {tCompass(`compassAbbr${find.directionFromDefault}`)}</>
          )}
        </p>
      )}
    </div>
  );
}

/**
 * Location codes run from 12 to ~50 characters
 * ("CZ_VALAŠSKÉMEZIŘÍČÍ_KRÁSNONADBEČVOU_SVĚRÁKOVA_001"). The tile is a fixed
 * grid cell, so the type steps down instead of wrapping onto a second line
 * and pushing the rest of the strip off the photo.
 */
function codeSizeClass(code: string): string {
  if (code.length <= 18) return "text-[11px]";
  if (code.length <= 26) return "text-[10px]";
  if (code.length <= 34) return "text-[9px]";
  return "text-[8px]";
}
