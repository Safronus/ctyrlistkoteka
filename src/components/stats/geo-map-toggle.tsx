"use client";

import { useState } from "react";
import { Globe, MapPin } from "lucide-react";

type Mode = "states" | "regions";

/**
 * Switches the geo map between "by country" (world) and "by Czech region"
 * (kraje). Both maps are server-rendered SVGs passed in as children and
 * just toggled with CSS, so flipping modes is instant and re-fetches
 * nothing.
 */
export function GeoMapToggle({
  statesLabel,
  regionsLabel,
  world,
  kraje,
}: {
  statesLabel: string;
  regionsLabel: string;
  world: React.ReactNode;
  kraje: React.ReactNode;
}) {
  const [mode, setMode] = useState<Mode>("states");
  return (
    <div>
      <div
        role="radiogroup"
        aria-label={`${statesLabel} / ${regionsLabel}`}
        className="mb-3 inline-flex overflow-hidden rounded-md border border-gray-300 bg-white"
      >
        <ModeButton
          active={mode === "states"}
          onClick={() => setMode("states")}
          icon={<Globe className="h-4 w-4" aria-hidden />}
          label={statesLabel}
        />
        <ModeButton
          active={mode === "regions"}
          onClick={() => setMode("regions")}
          icon={<MapPin className="h-4 w-4" aria-hidden />}
          label={regionsLabel}
          divider
        />
      </div>
      <div className={mode === "states" ? undefined : "hidden"}>{world}</div>
      <div className={mode === "regions" ? undefined : "hidden"}>{kraje}</div>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  icon,
  label,
  divider = false,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  divider?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition ${
        divider ? "border-l border-gray-300" : ""
      } ${
        active
          ? "bg-brand-600 text-white"
          : "bg-white text-gray-700 hover:bg-gray-50"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
