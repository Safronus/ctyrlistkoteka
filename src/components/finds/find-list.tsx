import Link from "next/link";
import type { PublicFind } from "@/lib/queries/finds";
import { FindThumbnail } from "./find-thumbnail";
import { StateBadges } from "./state-badges";
import { formatShortDateCs } from "@/lib/format";

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
  const locationName =
    find.location?.displayName ?? find.location?.code ?? "Bez lokality";
  const altText = find.isAnonymized
    ? `Anonymizovaný nález č. ${find.id}`
    : `Nález č. ${find.id} – ${locationName}`;

  return (
    <Link
      href={`/sbirka/${find.id}`}
      className="group flex items-stretch gap-4 p-3 transition hover:bg-brand-50"
    >
      <FindThumbnail
        image={find.primaryImage}
        alt={altText}
        className="h-20 w-20 shrink-0 rounded-md sm:h-24 sm:w-24"
      />
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate text-base font-medium text-gray-900 group-hover:text-brand-700">
            <span className="text-brand-700">#{find.id}</span>
            <span className="ml-2 font-normal text-gray-700">{locationName}</span>
          </p>
          <p className="shrink-0 text-xs text-gray-500">
            {formatShortDateCs(find.foundAt)}
          </p>
        </div>

        {find.notes && (
          <p className="truncate text-sm text-gray-600">{find.notes}</p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold text-brand-700">
            {find.leafCount} lístků
          </span>
          <StateBadges states={find.states} />
        </div>
      </div>
    </Link>
  );
}
