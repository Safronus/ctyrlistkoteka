"use client";

import Link from "next/link";
import { ExternalLink, ListIcon, MapPin, X } from "lucide-react";
import {
  FINDS,
  formatLocationId,
  locationDetailHref,
  pluralCs,
} from "@/lib/format";
import type { MapLocation } from "@/lib/queries/map";

const NF_CS = new Intl.NumberFormat("cs-CZ");

/**
 * "Top sheet" card surfaced when the visitor selects a location
 * (sidebar pick, polygon/dot tap, or `?focus=` / `?find=` deep link).
 * Replaces Leaflet's bound popup at every breakpoint — the popup
 * fought the floating Vrstvy / Lokality controls for stacking and edge
 * positioning, and the workarounds (z-index hops, fixed-top overrides)
 * leaked transparent strips and ordering bugs we don't want to keep
 * tracking. A regular React card escapes that whole surface.
 *
 * Position-agnostic by design: the outer div carries no `absolute`
 * placement so MapaShell can drop it into different wrappers — on
 * mobile a full-width banner below the top control row, on desktop a
 * flex sibling rendered right next to Vrstvy. Same component, same
 * close behaviour either way.
 */
export function LocationTopSheet({
  location,
  onClose,
}: {
  location: MapLocation;
  onClose: () => void;
}) {
  const idLabel = formatLocationId(location.id);
  const showSubtitle =
    location.displayName !== "" && location.displayName !== location.code;
  return (
    <div
      role="dialog"
      aria-label="Detail vybrané lokality"
      className="rounded-lg border border-gray-200 bg-white p-3 shadow-xl"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Zavřít"
        className="absolute right-1.5 top-1.5 rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>

      <div className="flex items-baseline gap-2 pr-7">
        <span className="font-mono text-[11px] text-gray-500">{idLabel}</span>
        <strong
          className="truncate text-sm leading-tight text-gray-900"
          title={location.code}
        >
          {location.code}
        </strong>
      </div>

      {showSubtitle && (
        <p
          className="mt-0.5 truncate text-xs leading-tight text-gray-600"
          title={location.displayName}
        >
          {location.displayName}
        </p>
      )}

      {(location.parentId !== null || location.isGone) && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {location.parentId !== null && (
            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium tracking-wide text-sky-900">
              dílčí část
            </span>
          )}
          {location.isGone && (
            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-900">
              Zaniklá
            </span>
          )}
        </div>
      )}

      <p className="mt-1.5 text-xs">
        <span className="font-mono text-sm font-semibold text-brand-700">
          {NF_CS.format(location.findCount)}
        </span>
        <span className="ml-1 text-gray-600">
          {pluralCs(location.findCount, FINDS)}
        </span>
      </p>

      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <Link
          href={locationDetailHref(location.id)}
          className="flex items-center justify-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[11px] font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          <span>Detail lokality</span>
        </Link>
        <Link
          href={`/sbirka?loc=${location.id}`}
          className="flex items-center justify-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[11px] font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm"
        >
          <ListIcon className="h-3.5 w-3.5" aria-hidden />
          <span>Ukázat nálezy</span>
        </Link>
      </div>

      {/* Subtle hint that the top sheet replaces the bound popup —
          clicking the map background still drops focus + closes this
          sheet via MapaShell's deselect handler, mirroring the popup
          behaviour visitors are used to. */}
      <p className="mt-1.5 flex items-center gap-1 text-[10px] leading-tight text-gray-400">
        <MapPin className="h-3 w-3" aria-hidden />
        <span>Kliknutím na mapu nebo X panel zavřete</span>
      </p>
    </div>
  );
}
