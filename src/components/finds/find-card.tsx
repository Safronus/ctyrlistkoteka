import Link from "next/link";
import type { PublicFind } from "@/lib/queries/finds";
import { FindThumbnail } from "./find-thumbnail";
import { StateBadges } from "./state-badges";
import { formatShortDateCs } from "@/lib/format";

export function FindCard({ find }: { find: PublicFind }) {
  const title = `Nález č. ${find.id}`;
  const locationName = find.location?.displayName ?? find.location?.code ?? "Bez lokality";
  const altText = find.isAnonymized
    ? `Anonymizovaný nález č. ${find.id}`
    : `${title} – ${locationName}`;

  return (
    <Link
      href={`/sbirka/${find.id}`}
      className="group block overflow-hidden rounded-lg border border-gray-200 bg-white transition hover:border-brand-200 hover:shadow-sm"
    >
      <FindThumbnail
        image={find.primaryImage}
        alt={altText}
        className="aspect-square"
      />
      <div className="space-y-1.5 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-medium text-gray-900 group-hover:text-brand-700">
            #{find.id}
          </p>
          <p className="text-xs text-gray-500">
            {formatShortDateCs(find.foundAt)}
          </p>
        </div>
        <p
          className="truncate text-sm text-gray-600"
          title={locationName}
        >
          {locationName}
        </p>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-brand-700">
            {find.leafCount} lístků
          </span>
          <StateBadges states={find.states} />
        </div>
      </div>
    </Link>
  );
}
