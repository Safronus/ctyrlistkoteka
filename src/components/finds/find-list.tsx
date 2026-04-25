import Link from "next/link";
import type { PublicFind } from "@/lib/queries/finds";
import { FindThumbnail } from "./find-thumbnail";
import { StateBadges } from "./state-badges";
import { formatDateTimeCs } from "@/lib/format";
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
  // Anonymized finds must not leak their actual location label here, just
  // like /sbirka/[id] hides it. Coordinates and notes are already stripped
  // upstream by anonymize().
  const locationName = find.isAnonymized
    ? "Anonymizovaná lokalita"
    : (find.location?.displayName ?? find.location?.code ?? "Bez lokality");
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
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="text-base font-semibold text-brand-700 group-hover:underline">
            #{find.id}
          </span>
          <span className="text-xs text-gray-500">
            {formatDateTimeCs(find.foundAt)}
          </span>
        </div>

        <p className="truncate text-sm text-gray-700" title={locationName}>
          {locationName}
        </p>

        {!find.isAnonymized && find.coordinates && (
          <p className="font-mono text-xs text-gray-500">
            {formatGpsApple(find.coordinates.lat, find.coordinates.lng)}
          </p>
        )}

        {find.states.length > 0 && <StateBadges states={find.states} />}

        {find.notes && (
          <p className="truncate text-sm text-gray-600">{find.notes}</p>
        )}
      </div>
    </Link>
  );
}
