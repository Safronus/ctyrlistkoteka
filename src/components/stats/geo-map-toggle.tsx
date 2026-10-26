"use client";

import { useState } from "react";

export interface GeoTab {
  /** Stable key (also the React key). */
  key: string;
  label: string;
  icon: React.ReactNode;
  /** The server-rendered map SVG for this tab. */
  node: React.ReactNode;
}

/**
 * Switches the geo map between its tabs (Svět / Evropa / Asie / Afrika /
 * ČR / USA). Every map is a server-rendered SVG passed in as `node` and
 * just toggled with CSS, so flipping tabs is instant and re-fetches
 * nothing. The first tab is active on load.
 */
export function GeoMapToggle({
  tabs,
  ariaLabel,
}: {
  tabs: GeoTab[];
  ariaLabel: string;
}) {
  const [active, setActive] = useState(tabs[0]?.key);
  return (
    <div>
      <div
        role="radiogroup"
        aria-label={ariaLabel}
        className="mb-3 inline-flex flex-wrap overflow-hidden rounded-md border border-gray-300 bg-white"
      >
        {tabs.map((tab, i) => (
          <ModeButton
            key={tab.key}
            active={active === tab.key}
            onClick={() => setActive(tab.key)}
            icon={tab.icon}
            label={tab.label}
            divider={i > 0}
          />
        ))}
      </div>
      {tabs.map((tab) => (
        <div key={tab.key} className={active === tab.key ? undefined : "hidden"}>
          {tab.node}
        </div>
      ))}
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
