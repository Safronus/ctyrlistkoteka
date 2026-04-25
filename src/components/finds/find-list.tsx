import Link from "next/link";
import type { PublicFind } from "@/lib/queries/finds";
import { FindThumbnail } from "./find-thumbnail";
import { StateBadges } from "./state-badges";
import { formatDateTimeCs, formatLocationId } from "@/lib/format";
import { formatGpsApple } from "@/lib/gpsFormat";

export function FindList({ finds }: { finds: readonly PublicFind[] }) {
  if (finds.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-12 text-center">
        <p className="text-gray-500">Žádné nálezy neodpovídají filtrům.</p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200 bg-white">
      {finds.map((find) => (
        <li key={find.id}>
          <FindListRow find={find} />
        </li>
      ))}
    </ul>
  );
}

function FindListRow({ find }: { find: PublicFind }) {
  // Anonymized finds must not leak their actual location id or label here,
  // mirroring the detail page's substitution. Coordinates and notes are
  // already stripped upstream by anonymize().
  const locationName = find.isAnonymized
    ? "Anonymizovaná lokalita"
    : (find.location?.displayName ?? find.location?.code ?? "Bez lokality");
  const locationId =
    !find.isAnonymized && find.location
      ? formatLocationId(find.location.id)
      : null;
  const altText = find.isAnonymized
    ? `Anonymizovaný nález #${find.id}`
    : `Nález #${find.id} – ${locationName}`;

  return (
    <Link
      href={`/sbirka/${find.id}`}
      className="group flex items-stretch gap-4 p-3 transition hover:bg-brand-50"
    >
      <FindThumbnail
        image={find.primaryImage}
        alt={altText}
        className="h-24 w-24 shrink-0 rounded-md sm:h-28 sm:w-28"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {/* Title row: #ID, #LocId and location label all left, datetime
            flush right. The location label truncates on narrow widths. */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-base font-semibold text-brand-700 group-hover:underline">
              #{find.id}
            </span>
            {locationId && (
              <span className="font-mono text-xs text-gray-500">
                {locationId}
              </span>
            )}
            <span
              className="truncate text-sm text-gray-700"
              title={locationName}
            >
              {locationName}
            </span>
          </div>
          <span className="shrink-0 text-xs text-gray-500">
            {formatDateTimeCs(find.foundAt)}
          </span>
        </div>

        {!find.isAnonymized && find.coordinates && (
          <p className="font-mono text-xs text-gray-500">
            {formatGpsApple(find.coordinates.lat, find.coordinates.lng)}
          </p>
        )}

        {find.notes && (
          <p className="line-clamp-2 text-sm text-gray-600">{find.notes}</p>
        )}

        {find.states.length > 0 && (
          <div className="mt-auto self-end">
            <StateBadges states={find.states} />
          </div>
        )}
      </div>
    </Link>
  );
}
