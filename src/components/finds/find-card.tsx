import { getLocale, getTranslations } from "next-intl/server";
import { FindState } from "@prisma/client";
import { Camera, Images, Trophy } from "lucide-react";
import { Link } from "@/i18n/navigation";
import type { PublicFind } from "@/lib/queries/finds";
import { FindThumbnail, cropVariant } from "./find-thumbnail";
import { StateBadges } from "./state-badges";
import { VoteButton } from "./vote-button";
import { formatShortDateTimeCs } from "@/lib/format";

export async function FindCard({
  find,
  voted,
  voteCount,
  priority = false,
}: {
  find: PublicFind;
  voted: boolean;
  voteCount: number;
  /** Eager-load this card's thumbnail (first grid row) to fix the LCP. */
  priority?: boolean;
}) {
  const locale = await getLocale();
  const tRow = await getTranslations("FindRow");

  const altText = find.isAnonymized
    ? tRow("anonymizedAlt", { id: find.id })
    : tRow("findAlt", { id: find.id });

  return (
    <Link
      href={`/sbirka/${find.id}`}
      className="group block overflow-hidden rounded-lg border border-gray-200 bg-white transition hover:border-brand-200 hover:shadow-sm"
    >
      {/* Find number banner above the photo, centred: "🍀 #123". */}
      <div className="flex items-center justify-center gap-1.5 px-3 py-2">
        <span className="text-sm font-semibold text-gray-900 group-hover:text-brand-700">
          🍀 #{find.id}
        </span>
        {find.isRecord && (
          <span
            className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700"
            title={tRow("recordBadgeTitle")}
          >
            <Trophy className="h-3 w-3" aria-hidden />
            {tRow("recordBadge")}
          </span>
        )}
      </div>

      <div className="relative">
        {/* LOST finds render their photo in grayscale — the quiet
            list-level echo of the detail page's elegy treatment. The
            overlays are siblings, so they keep their colours. */}
        <FindThumbnail
          image={cropVariant(find.primaryImage, find.images) ?? find.primaryImage}
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
        {/* Vote button — top-right corner. Only when a thumbnail exists
         *  (no-photo finds have nothing to vote on). */}
        {find.primaryImage && (
          <div className="absolute right-2 top-2">
            <VoteButton
              findId={find.id}
              initialVoted={voted}
              initialCount={voteCount}
              variant="overlay"
            />
          </div>
        )}
        {/* Date + time — bottom overlay, centred, over a strong gradient +
            text-shadow so it stays legible on any photo (incl. bright /
            grayscale ones). */}
        {find.foundAt && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-2 pb-2 pt-9">
            <p className="text-center text-xs font-semibold tracking-tight text-white [text-shadow:0_1px_4px_rgba(0,0,0,0.95)]">
              {formatShortDateTimeCs(find.foundAt, locale)}
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
      </div>
    </Link>
  );
}
