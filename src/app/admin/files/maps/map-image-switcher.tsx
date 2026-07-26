"use client";

import { useState } from "react";
import { Image as ImageIcon, Layers } from "lucide-react";

/**
 * Preview for a v2 location map with a Nosná / Rendered switch.
 *
 * A v2 package ships two images per map — the clean base ("Nosná", what the
 * public site overlays) and the one with the marker / polygon / ID drawn in
 * ("Rendered"). Both live under the same basename in different directories,
 * so the admin file endpoint picks between them with `?variant=`.
 *
 * Rendered is optional: when the package didn't ship one the switch collapses
 * to a plain preview rather than offering a tab that would 404.
 */
export function MapImageSwitcher({
  name,
  version,
  hasRendered,
}: {
  /** Nosná basename — the map's identity for both variants. */
  name: string;
  /** Cache-busting token (the file's mtime), passed through to the URL. */
  version: string;
  hasRendered: boolean;
}) {
  const [variant, setVariant] = useState<"nosna" | "rendered">("nosna");
  const active = hasRendered ? variant : "nosna";
  const url =
    `/api/admin/file?scope=maps&name=${encodeURIComponent(name)}` +
    `&v=${version}${active === "rendered" ? "&variant=rendered" : ""}`;

  return (
    <figure className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50 p-2">
      {hasRendered && (
        <div
          role="radiogroup"
          aria-label="Verze mapy"
          className="mb-2 inline-flex items-center gap-0.5 rounded-md border border-gray-200 bg-white p-0.5"
        >
          <Tab
            active={active === "nosna"}
            onClick={() => setVariant("nosna")}
            icon={<ImageIcon className="h-3.5 w-3.5" aria-hidden />}
            label="Nosná"
            title="Čistý podklad — to, co web podkládá pod polygon"
          />
          <Tab
            active={active === "rendered"}
            onClick={() => setVariant("rendered")}
            icon={<Layers className="h-3.5 w-3.5" aria-hidden />}
            label="Rendered"
            title="S vykresleným markerem / polygonem / ID lokace"
          />
        </div>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={`${name} (${active === "rendered" ? "rendered" : "nosná"})`}
        className="mx-auto block max-h-[60vh] w-auto rounded"
      />
      {!hasRendered && (
        <figcaption className="mt-1.5 text-center text-[11px] text-gray-500">
          Balíček k této mapě nedodal &bdquo;Rendered&ldquo; verzi.
        </figcaption>
      )}
    </figure>
  );
}

function Tab({
  active,
  onClick,
  icon,
  label,
  title,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  title: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      title={title}
      className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition ${
        active
          ? "bg-brand-50 text-brand-800"
          : "text-gray-600 hover:text-gray-900"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
