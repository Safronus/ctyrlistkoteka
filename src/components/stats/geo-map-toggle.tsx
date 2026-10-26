"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

export interface GeoTab {
  /** Stable key (also the React key). */
  key: string;
  label: string;
  icon: React.ReactNode;
  /** A map rendered with the page (world, ČR, USA). */
  node?: React.ReactNode;
  /** …or a map fetched on first use (the continents): an SVG document
   *  from `/api/stats/continent-map/…`, with its viewBox size so the
   *  placeholder reserves the right height before it arrives. */
  lazy?: { src: string; width: number; height: number };
}

type LoadState = "loading" | "error";

/**
 * Switches the geo map between its tabs. Inline maps are server-rendered
 * and just toggled with CSS. Continent maps are heavier (fine 50m borders),
 * so they stay out of the page HTML and are fetched the first time their
 * tab is clicked — already on hover, so the click usually finds them ready
 * — then kept for the rest of the visit. The first tab is active on load.
 */
export function GeoMapToggle({
  tabs,
  ariaLabel,
  loadingLabel,
  errorLabel,
  retryLabel,
}: {
  tabs: GeoTab[];
  ariaLabel: string;
  loadingLabel: string;
  errorLabel: string;
  retryLabel: string;
}) {
  const [active, setActive] = useState(tabs[0]?.key);
  const [svgs, setSvgs] = useState<Record<string, string>>({});
  const [state, setState] = useState<Record<string, LoadState>>({});

  // Started from event handlers (hover / click / retry), never from an
  // effect, so a tab nobody touches costs nothing.
  const load = async (tab: GeoTab) => {
    if (!tab.lazy || svgs[tab.key] || state[tab.key] === "loading") return;
    setState((s) => ({ ...s, [tab.key]: "loading" }));
    try {
      const res = await fetch(tab.lazy.src);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const svg = await res.text();
      setSvgs((m) => ({ ...m, [tab.key]: svg }));
      setState((s) => {
        const next = { ...s };
        delete next[tab.key];
        return next;
      });
    } catch {
      setState((s) => ({ ...s, [tab.key]: "error" }));
    }
  };

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
            onClick={() => {
              setActive(tab.key);
              void load(tab);
            }}
            onHover={() => void load(tab)}
            icon={tab.icon}
            label={tab.label}
            divider={i > 0}
          />
        ))}
      </div>
      {tabs.map((tab) => (
        <div key={tab.key} className={active === tab.key ? undefined : "hidden"}>
          {tab.node ??
            (tab.lazy && svgs[tab.key] ? (
              <div
                className="overflow-hidden rounded-xl border border-gray-200"
                style={{ background: "oklch(0.92 0.02 220)" }}
                // Our own server's SVG: geometry plus escaped country names.
                dangerouslySetInnerHTML={{ __html: svgs[tab.key]! }}
              />
            ) : tab.lazy ? (
              <div
                className="flex items-center justify-center overflow-hidden rounded-xl border border-gray-200 text-sm text-gray-600"
                style={{
                  background: "oklch(0.92 0.02 220)",
                  aspectRatio: `${tab.lazy.width} / ${tab.lazy.height}`,
                  maxHeight: "85vh",
                }}
              >
                {state[tab.key] === "error" ? (
                  <span className="flex flex-col items-center gap-2">
                    {errorLabel}
                    <button
                      type="button"
                      onClick={() => void load(tab)}
                      className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm"
                    >
                      {retryLabel}
                    </button>
                  </span>
                ) : (
                  <span className="flex items-center gap-2" role="status">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    {loadingLabel}
                  </span>
                )}
              </div>
            ) : null)}
        </div>
      ))}
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  onHover,
  icon,
  label,
  divider = false,
}: {
  active: boolean;
  onClick: () => void;
  onHover: () => void;
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
      onPointerEnter={onHover}
      onFocus={onHover}
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
