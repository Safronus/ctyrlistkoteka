"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Info, ListIcon, X } from "lucide-react";
import { MapLoader } from "./map-loader";
import { MapSidebar } from "./map-sidebar";
import { LocationTopSheet } from "./location-top-sheet";
import type { MapData } from "@/lib/queries/map";
import type { LocationListItem } from "@/lib/queries/locations";
import type { HighlightFind } from "@/lib/queries/finds";

/**
 * Wraps the Leaflet map and the right-hand sidebar in a single client
 * component so they can share state: which location is currently
 * focused, whether the sidebar is open, and which overlay layers are
 * visible. Server data flows in once via props; everything interactive
 * is local.
 */
// Default location to focus when the URL doesn't specify one. Matches
// "lokalita 00001" — typically ZLÍN_JSVAHY-UTB-U5-001. Falls back to the
// first available location if id 1 doesn't exist anymore.
const DEFAULT_FOCUS_ID = 1;

// localStorage keys for visitor-level layer preferences. CLAUDE.md §3
// allows localStorage for UI preferences — toggling map overlays
// qualifies. SSR can't read localStorage, so the first paint always
// shows the defaults; the effect below rehydrates after mount.
const LS_KEY_LOCATIONS = "mapa.layers.locations";
const LS_KEY_FINDS = "mapa.layers.finds";
const LS_KEY_GONE = "mapa.layers.gone";

export function MapaShell({
  mapData,
  sidebarLocations,
  urlFocusId,
  highlightFind,
  highlightFindIds,
}: {
  mapData: MapData;
  sidebarLocations: readonly LocationListItem[];
  urlFocusId: number | null;
  /** Set when the page received `?find=N` and the find resolved to public
   *  GPS — the map then renders a single highlighted marker, auto-zooms
   *  to it, and starts with the bulk Nálezy layer hidden so the focus
   *  stays on this one row. */
  highlightFind: HighlightFind | null;
  /** Find IDs to keep bright on the canvas. Pre-resolved server-side
   *  from /sbirka filter params so the visitor sees their filtered set
   *  highlighted against the rest of the map. */
  highlightFindIds: ReadonlySet<number> | null;
}) {
  // Selection (focus) and initial centering are deliberately separate:
  //   - On a bare /mapa visit the map should *centre* on location 00001
  //     so visitors land on familiar territory, but nothing is selected
  //     yet — no orange highlight, no popup.
  //   - Deep links (`?focus=N` from /lokality, `?find=N` from /sbirka)
  //     do select the target location, since the visitor explicitly
  //     asked to see it.
  // `initialFitLocationId` drives the first fitBounds; `focusId` drives
  // the highlight + subsequent re-fits when the user picks a row.
  const initialFitLocationId =
    highlightFind?.locationId ??
    urlFocusId ??
    mapData.locations.find((l) => l.id === DEFAULT_FOCUS_ID)?.id ??
    mapData.locations[0]?.id ??
    null;
  const [focusId, setFocusId] = useState<number | null>(
    urlFocusId ?? highlightFind?.locationId ?? null,
  );
  // Sidebar auto-opens when the URL explicitly carried ?focus=N or
  // ?find=N (deep-link from /lokality or /sbirka). A bare /mapa visit
  // keeps it closed even though we still focus the default location on
  // the map. On mobile we override below — the bottom-sheet covers most
  // of the viewport, so a deep-link arrival should let the visitor SEE
  // the location first.
  const [sidebarOpen, setSidebarOpen] = useState(
    urlFocusId !== null || highlightFind !== null,
  );
  // Vrstvy is space-hungry on a phone; collapse it by default below md
  // so the visitor sees the map under the floating control. Desktop
  // keeps it expanded since vertical real-estate is plentiful there.
  // (Legenda is now a thin bar at the bottom edge — no collapse needed.)
  const [layersExpanded, setLayersExpanded] = useState(true);
  // Reactive viewport flag — drives the location top-sheet on mobile
  // and the auto-collapse of Vrstvy when that sheet is showing. We need
  // it to update on resize / orientation change too, so the listener
  // is wired up below; the previous code only checked once on mount.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 767px)");
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const isDesktop = window.matchMedia("(min-width: 768px)").matches;
    if (!isDesktop) {
      setLayersExpanded(false);
      // Mobile deep-link → keep the map clear; visitor came to see the
      // pinned location, not the list. They can tap the Lokality pill
      // to open the sheet at any time.
      if (urlFocusId !== null || highlightFind !== null) {
        setSidebarOpen(false);
      }
    }
    // Single-shot — initial layout decision based on viewport at mount.
    // The user can freely toggle afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [showLocations, setShowLocations] = useState(true);
  // Highlight mode hides the bulk find layer by default — the visitor
  // came from a single-find link, the other 17k dots would just drown
  // the marker they were sent to. They can flip the layer back on in
  // the sidebar if they want full context; the highlight stays.
  const [showFinds, setShowFinds] = useState(highlightFind === null);
  // Once the visitor explicitly picks a different location (sidebar or
  // polygon), the URL-driven highlight is no longer the primary subject
  // and must step aside — otherwise MapView's bounds memo keeps the
  // viewport zoomed on the highlight find regardless of focusLocationId,
  // and the FitBounds key (`find-N`) never changes so no refit fires.
  // Result before this flag: clicking a sidebar row did nothing (or
  // dropped the visitor on the wrong place).
  const [highlightCleared, setHighlightCleared] = useState(false);
  const effectiveHighlightFind = highlightCleared ? null : highlightFind;
  // Former (NEEXISTUJE-) locations stay hidden by default — the typical
  // visitor wants to browse active places. Toggling them on reveals the
  // red striped polygons + dots; legend swatch matches either way.
  const [showGone, setShowGone] = useState(false);

  // Children of polygon-owning parents are hidden by default — they'd
  // stack on top of the parent's polygon and clutter the view. The
  // sidebar exposes a per-row toggle and any deep link into a child
  // location (`/mapa?focus=<child-id>`) is auto-enabled, so the visitor
  // arriving from /statistiky's TOP-by-density row sees the polygon
  // they came for instead of an empty parent shape.
  const sidebarById = useMemo(
    () => new Map(sidebarLocations.map((l) => [l.id, l])),
    [sidebarLocations],
  );
  const isChild = useCallback(
    (id: number) => (sidebarById.get(id)?.parentId ?? null) !== null,
    [sidebarById],
  );
  const isGone = useCallback(
    (id: number) => sidebarById.get(id)?.isGone === true,
    [sidebarById],
  );

  // Counts shown next to each Vrstvy toggle. Keep them aligned with what
  // the toggle actually shows on the map: "Lokace" only counts active
  // locations now that "Zaniklé" is its own row, and "Zaniklé" counts
  // the former ones that toggle reveals.
  const activeLocationCount = useMemo(
    () => sidebarLocations.filter((l) => !l.isGone).length,
    [sidebarLocations],
  );
  const goneLocationCount = useMemo(
    () => sidebarLocations.filter((l) => l.isGone).length,
    [sidebarLocations],
  );
  const [enabledChildPolygonIds, setEnabledChildPolygonIds] = useState<
    Set<number>
  >(() => {
    const set = new Set<number>();
    // The deep-link target — either the location requested via
    // `?focus=<id>` or the home location of a `?find=<n>` find — gets
    // its child polygon opted in by default. Without this, a visitor
    // arriving from /sbirka onto a find inside a child location would
    // see only the parent's polygon shell wrapping the AOI they came
    // for.
    const targets: Array<number | null> = [
      urlFocusId,
      highlightFind?.locationId ?? null,
    ];
    for (const id of targets) {
      if (id === null) continue;
      const loc = sidebarLocations.find((l) => l.id === id);
      if (loc && loc.parentId !== null) set.add(id);
    }
    return set;
  });
  const handleSelectLocation = useCallback(
    (id: number) => {
      setFocusId(id);
      // Drop the URL-driven highlight as soon as the user picks any
      // location themselves — see `highlightCleared` declaration above
      // for why this is needed for bounds/refit to work.
      setHighlightCleared(true);
      // Auto-enable the polygon when the user picks a child row, so
      // the focus animation lands on a visible shape rather than a
      // blank centre point — matches the deep-link behaviour above.
      if (isChild(id)) {
        setEnabledChildPolygonIds((prev) => {
          if (prev.has(id)) return prev;
          const next = new Set(prev);
          next.add(id);
          return next;
        });
      }
      // Auto-flip the Zaniklé layer on when the visitor picks a former
      // location from the sidebar — focusing a hidden polygon would
      // otherwise zoom the map onto a blank patch with no visual cue.
      if (isGone(id)) {
        setShowGone(true);
      }
    },
    [isChild, isGone],
  );
  const handleDeselectLocation = useCallback(() => {
    // Plain "click outside" — drop the highlight without re-fitting the
    // viewport (the user is already where they want to be, they just
    // want the orange selection gone).
    setFocusId(null);
  }, []);

  const handleHighlightDismiss = useCallback(() => {
    // Closing the deep-link popup exits highlight mode IN PLACE: drop
    // both the highlight marker AND the auto-focus on its location, so
    // FitBounds sees `focusKey === null` and skips the refit. Result:
    // the viewport stays exactly where the visitor is, but the orange
    // outline + clover marker disappear and the page is back to normal
    // interaction.
    setHighlightCleared(true);
    setFocusId(null);
    // Bulk Nálezy layer was suppressed on arrival so the single
    // highlight could stand out — turning it back on as the visitor
    // dismisses the popup matches "normal mode" expectations and
    // surfaces the surrounding find dots they likely came to explore.
    setShowFinds(true);
  }, []);

  const handleToggleChildPolygon = useCallback((id: number) => {
    setEnabledChildPolygonIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Resolve the picked row from `mapData.locations` (the source of truth
  // for polygon/centre data) so the top-sheet renders the same
  // attributes the bound popup would show. `sidebarLocations` could
  // also work but `mapData.locations` already lives client-side and the
  // find is O(n) in 128 rows.
  //
  // Suppressed while a find highlight is active: when the visitor
  // arrives via `?find=N` the HighlightFindMarker carries its own
  // popup and IS the primary subject. Layering the location top-sheet
  // on top would just clobber it with information about the polygon
  // wrapping the find. As soon as the visitor dismisses the highlight
  // (or picks a different location, which clears it via
  // setHighlightCleared) the top-sheet is back in play.
  const focusedLocation = useMemo(() => {
    if (focusId === null) return null;
    if (effectiveHighlightFind !== null) return null;
    return mapData.locations.find((l) => l.id === focusId) ?? null;
  }, [focusId, mapData.locations, effectiveHighlightFind]);

  // When the location top-sheet is shown on mobile, force-collapse
  // Vrstvy. Expanded Vrstvy can grow into the top-sheet's row (~140 px)
  // and the sheet covers the controls, which the user explicitly does
  // not want. The collapse is one-way: we don't auto-expand again on
  // close because most mobile visitors leave Vrstvy collapsed anyway.
  useEffect(() => {
    if (isMobile && focusedLocation !== null) {
      setLayersExpanded(false);
    }
  }, [isMobile, focusedLocation]);

  // Rehydrate visitor preferences after mount. Wrapped in try/catch
  // because localStorage can throw in private mode / when disabled.
  // The Nálezy preference is intentionally skipped under highlight
  // deep-link — the user just clicked a find from /sbirka and the
  // forced-off default for the bulk layer is the whole point. They can
  // still flip it on by hand, and we save that choice so a manual
  // override survives across reloads.
  const hasHighlight = highlightFind !== null;
  useEffect(() => {
    try {
      const sl = window.localStorage.getItem(LS_KEY_LOCATIONS);
      if (sl === "false") setShowLocations(false);
      if (!hasHighlight) {
        const sf = window.localStorage.getItem(LS_KEY_FINDS);
        if (sf === "false") setShowFinds(false);
      }
      // showGone is opt-in — only flip it on if the user explicitly
      // saved "true". A missing or "false" key keeps former locations
      // hidden, matching the default.
      const sg = window.localStorage.getItem(LS_KEY_GONE);
      if (sg === "true") setShowGone(true);
    } catch {
      /* localStorage unavailable — keep defaults */
    }
  }, [hasHighlight]);

  useEffect(() => {
    try {
      window.localStorage.setItem(LS_KEY_LOCATIONS, String(showLocations));
    } catch {
      /* ignore */
    }
  }, [showLocations]);
  useEffect(() => {
    try {
      window.localStorage.setItem(LS_KEY_FINDS, String(showFinds));
    } catch {
      /* ignore */
    }
  }, [showFinds]);
  useEffect(() => {
    try {
      window.localStorage.setItem(LS_KEY_GONE, String(showGone));
    } catch {
      /* ignore */
    }
  }, [showGone]);

  return (
    <div className="relative h-full w-full">
      <MapLoader
        data={mapData}
        focusLocationId={focusId}
        initialFitLocationId={initialFitLocationId}
        showLocations={showLocations}
        showFinds={showFinds}
        showGone={showGone}
        enabledChildPolygonIds={enabledChildPolygonIds}
        highlightFind={effectiveHighlightFind}
        highlightFindIds={highlightFindIds}
        onSelectLocation={handleSelectLocation}
        onDeselectLocation={handleDeselectLocation}
        onHighlightDismiss={handleHighlightDismiss}
        enableLocationPopup={false}
      />

      {/* Mobile placement of the top sheet — full-width banner below
          the top control row. Hidden on desktop where the sheet
          renders inside the Vrstvy flex row instead (see below). */}
      {focusedLocation && (
        <div className="absolute inset-x-2 top-14 z-[450] md:hidden">
          <LocationTopSheet
            location={focusedLocation}
            onClose={handleDeselectLocation}
          />
        </div>
      )}

      {/* GPS-accuracy notice. Pinned bottom-left so it sits above OSM
          attribution but stays clear of the sidebar (right) and zoom
          controls (top-left). Only relevant when the find dots are
          actually drawn — hidden when the layer is off or empty. */}
      {showFinds && mapData.findCoords.length > 0 && (
        <div
          role="status"
          className="pointer-events-none absolute bottom-6 left-3 z-[400] max-w-xs rounded-md border border-amber-200 bg-amber-50/95 px-3 py-2 text-xs text-amber-900 shadow-md"
        >
          <p className="flex items-start gap-1.5">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              Pozice nálezů jsou orientační — mohou se lišit od reálné
              polohy kvůli odchylce GPS.
            </span>
          </p>
        </div>
      )}

      {/* Toggle pill — hidden when the sidebar itself is open since it
          carries its own close button. */}
      {!sidebarOpen && (
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="absolute right-3 top-3 z-[400] inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-md transition hover:border-brand-200 hover:text-brand-700"
          aria-label="Otevřít seznam lokalit"
        >
          <ListIcon className="h-4 w-4" aria-hidden />
          <span>Lokality ({sidebarLocations.length})</span>
        </button>
      )}

      {sidebarOpen && (
        <>
          {/* Mobile / narrow tablet (< md): bottom-sheet panel. The
           *  right-side panel would cover the whole map at this width,
           *  so we anchor to the bottom edge instead and cap the height
           *  so the upper map area + floating controls stay usable.
           *  Capped at half the viewport so the map above the sheet
           *  stays meaningful — 70vh swallowed almost everything. */}
          <aside
            className="absolute inset-x-0 bottom-0 z-[400] flex max-h-[50vh] flex-col rounded-t-2xl border border-gray-200 bg-white shadow-2xl md:hidden"
            aria-label="Ovládání mapy"
          >
            <div className="relative flex items-center justify-center border-b border-gray-200 px-2 py-2">
              {/* Drag-handle pill — purely decorative, signals the sheet
               *  affordance without committing to a swipe-to-dismiss
               *  gesture (which Leaflet's pan handler would fight). */}
              <span
                aria-hidden
                className="h-1 w-10 rounded-full bg-gray-300"
              />
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
                aria-label="Zavřít panel"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <MapSidebar
              locations={sidebarLocations}
              focusId={focusId}
              onSelect={handleSelectLocation}
              enabledChildPolygonIds={enabledChildPolygonIds}
              onToggleChildPolygon={handleToggleChildPolygon}
              anonymizedLocationCount={mapData.anonymizedLocationCount}
            />
          </aside>

          {/* Desktop (md+): right-side panel — same shape as before the
           *  bottom-sheet split. The two siblings are mutually exclusive
           *  via Tailwind responsive utilities, so only one ever paints.
           *  At lg+ the panel widens to 36 rem (~1.5× the md width) so
           *  long location codes + their meta read on one line and the
           *  hierarchy chips don't fight for space — the map area still
           *  has plenty of room at typical desktop widths. Tablet (md→lg)
           *  keeps the snug 24 rem to leave the map navigable. */}
          <aside
            className="absolute right-0 top-0 z-[400] hidden h-full w-96 flex-col border-l border-gray-200 bg-white shadow-xl md:flex lg:w-[36rem]"
            aria-label="Ovládání mapy"
          >
            <div className="flex items-center justify-end border-b border-gray-200 px-2 py-1">
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
                aria-label="Zavřít panel"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <MapSidebar
              locations={sidebarLocations}
              focusId={focusId}
              onSelect={handleSelectLocation}
              enabledChildPolygonIds={enabledChildPolygonIds}
              onToggleChildPolygon={handleToggleChildPolygon}
              anonymizedLocationCount={mapData.anonymizedLocationCount}
            />
          </aside>
        </>
      )}

      {/* Vrstvy lives OUTSIDE the sidebar so it stays visible when the
       *  panel is collapsed. Sits flush in the top-left corner across
       *  every viewport — Leaflet's +/- zoom buttons are hidden globally
       *  (see globals.css) since pinch / trackpad / scroll-wheel zoom
       *  covers the gesture and the corner reads cleaner without them.
       *
       *  On desktop the location top sheet renders as a flex sibling
       *  to the right of Vrstvy via `hidden md:block`, so an expanded
       *  layer card and the selected-location card share a single row.
       *  Mobile gets its own full-width banner below this row (see the
       *  separate wrapper above) — there's no horizontal room next to
       *  Vrstvy on a phone.
       *
       *  Width is capped on mobile (w-40 = 10rem) so the card fits
       *  between the corner and the right-side "Lokality" pill on a
       *  375px viewport without overlapping. Desktop drops the cap. */}
      <div className="absolute left-3 top-3 z-[400] flex items-start gap-2">
        <div className="w-40 shrink-0 md:w-auto md:max-w-xs">
          <LayerToggleCard
            showLocations={showLocations}
            onToggleLocations={setShowLocations}
            showFinds={showFinds}
            onToggleFinds={setShowFinds}
            showGone={showGone}
            onToggleGone={setShowGone}
            locationCount={activeLocationCount}
            goneCount={goneLocationCount}
            findCount={mapData.findCoords.length}
            findCountTotal={mapData.findCountTotal}
            expanded={layersExpanded}
            onToggleExpanded={() => setLayersExpanded((v) => !v)}
          />
        </div>
        {focusedLocation && (
          <div className="hidden shrink-0 md:block md:w-80">
            <LocationTopSheet
              location={focusedLocation}
              onClose={handleDeselectLocation}
            />
          </div>
        )}
      </div>

      {/* Legenda — jednořádková lišta u dolního okraje, vizuálně
       *  sladěná s Leaflet attribution na pravé straně (stejná výška,
       *  stejný typ pozadí). Zabírá minimum místa a sedí pod
       *  informačním proužkem o GPS přesnosti. */}
      <MapLegendBar />

      {/* Hidden defs SVG — provides the diagonal-stripes pattern used as
       *  fill for former-location polygons. Lives in the same document
       *  as the leaflet-overlay-pane SVG so `fill="url(#…)"` resolves. */}
      <svg
        aria-hidden
        focusable={false}
        style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
      >
        <defs>
          <pattern
            id="ctyr-former-stripes"
            patternUnits="userSpaceOnUse"
            width={10}
            height={10}
            patternTransform="rotate(45)"
          >
            {/* Rose-100 backdrop + rose-600 stripes — saturated enough
             *  to read as "former" against OSM tiles, distinct from
             *  the amber focus highlight and the blue active polygons. */}
            <rect width={10} height={10} fill="#ffe4e6" fillOpacity={0.7} />
            <line
              x1={0}
              y1={0}
              x2={0}
              y2={10}
              stroke="#e11d48"
              strokeWidth={3}
            />
          </pattern>
        </defs>
      </svg>
    </div>
  );
}

function LayerToggleCard({
  showLocations,
  onToggleLocations,
  showFinds,
  onToggleFinds,
  showGone,
  onToggleGone,
  locationCount,
  goneCount,
  findCount,
  findCountTotal,
  expanded,
  onToggleExpanded,
}: {
  showLocations: boolean;
  onToggleLocations: (v: boolean) => void;
  showFinds: boolean;
  onToggleFinds: (v: boolean) => void;
  showGone: boolean;
  onToggleGone: (v: boolean) => void;
  locationCount: number;
  goneCount: number;
  findCount: number;
  findCountTotal: number;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  // Visitors comparing the home page (e.g. "1 735 nálezů") with this
  // count saw the difference and assumed a bug; calling out the gap
  // explains it: anonymized + GPS-less finds aren't on the map.
  const hiddenFinds = Math.max(0, findCountTotal - findCount);
  return (
    <div className="rounded-md border border-gray-200 bg-white px-2.5 py-2 text-sm shadow-md">
      <button
        type="button"
        onClick={onToggleExpanded}
        className="flex w-full items-center justify-between gap-2 rounded text-left"
        aria-expanded={expanded}
        aria-label={expanded ? "Sbalit vrstvy" : "Rozbalit vrstvy"}
      >
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          Vrstvy
        </h3>
        <ChevronDown
          className={`h-3.5 w-3.5 text-gray-400 transition-transform ${
            expanded ? "" : "-rotate-90"
          }`}
          aria-hidden
        />
      </button>
      {expanded && (
        <div className="mt-1 space-y-0.5">
          <ToggleRow
            label="Lokace"
            count={locationCount}
            checked={showLocations}
            onChange={onToggleLocations}
          />
          {/* Zaniklé as a visual sub-row of Lokace — indented and tied
           *  to its parent by a left rule, matching the master/detail
           *  semantic. Goes muted when the parent toggle is off. */}
          <div className="ml-2 border-l border-gray-200 pl-2">
            <ToggleRow
              label="Zaniklé"
              count={goneCount}
              checked={showGone}
              onChange={onToggleGone}
              disabled={!showLocations}
            />
          </div>
          <ToggleRow
            label="Nálezy"
            count={findCount}
            checked={showFinds}
            onChange={onToggleFinds}
            subtitle={
              hiddenFinds > 0
                ? `+ ${hiddenFinds.toLocaleString("cs-CZ")} skrytých (anonym./bez GPS)`
                : undefined
            }
          />
        </div>
      )}
    </div>
  );
}

function ToggleRow({
  label,
  count,
  checked,
  onChange,
  disabled = false,
  subtitle,
}: {
  label: string;
  count: number;
  checked: boolean;
  onChange: (v: boolean) => void;
  /** When true the row reads as muted and the checkbox is non-interactive.
   *  Used by the Zaniklé sub-toggle so it visually defers to the Lokace
   *  master switch — flipping Lokace off greys out the gone sub-control. */
  disabled?: boolean;
  /** Optional small line shown under the label — e.g. "+ 36 skrytých"
   *  on the Nálezy row when anonymized / no-GPS finds aren't on the
   *  map. Aligns with the checkbox column above. */
  subtitle?: string;
}) {
  return (
    <label
      className={`block rounded px-1 py-0.5 text-sm ${
        disabled
          ? "cursor-not-allowed text-gray-400"
          : "cursor-pointer text-gray-700 hover:bg-gray-50"
      }`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <span>{label}</span>
        </span>
        <span className="font-mono text-xs text-gray-500">
          ({count.toLocaleString("cs-CZ")})
        </span>
      </span>
      {subtitle && (
        <span className="ml-6 mt-0.5 block text-[11px] text-gray-500">
          {subtitle}
        </span>
      )}
    </label>
  );
}

function MapLegendBar() {
  return (
    <div className="pointer-events-none absolute bottom-0 left-0 z-[400] flex items-center gap-1.5 rounded-tr bg-white/80 px-1.5 py-px text-[11px] leading-none text-gray-700 shadow-sm">
      <LegendInline swatch={<ActiveSwatch />} label="Aktivní" />
      <span aria-hidden className="text-gray-300">
        ·
      </span>
      <LegendInline swatch={<FormerSwatch />} label="Zaniklá" />
      <span aria-hidden className="text-gray-300">
        ·
      </span>
      <LegendInline swatch={<FocusedSwatch />} label="Vybraná" />
    </div>
  );
}

function LegendInline({
  swatch,
  label,
}: {
  swatch: React.ReactNode;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      {swatch}
      <span>{label}</span>
    </span>
  );
}

const SWATCH_W = 14;
const SWATCH_H = 8;

function ActiveSwatch() {
  return (
    <svg
      width={SWATCH_W}
      height={SWATCH_H}
      aria-hidden
      focusable={false}
      className="overflow-hidden rounded-sm"
    >
      <rect
        width={SWATCH_W}
        height={SWATCH_H}
        fill="#3b82f6"
        fillOpacity={0.25}
        stroke="#1e40af"
        strokeWidth={2}
      />
    </svg>
  );
}

function FormerSwatch() {
  return (
    <svg
      width={SWATCH_W}
      height={SWATCH_H}
      aria-hidden
      focusable={false}
      className="overflow-hidden rounded-sm"
    >
      <rect
        width={SWATCH_W}
        height={SWATCH_H}
        fill="url(#ctyr-former-stripes)"
        fillOpacity={0.95}
        stroke="#be123c"
        strokeWidth={2}
      />
    </svg>
  );
}

function FocusedSwatch() {
  return (
    <svg
      width={SWATCH_W}
      height={SWATCH_H}
      aria-hidden
      focusable={false}
      className="overflow-hidden rounded-sm"
    >
      <rect
        width={SWATCH_W}
        height={SWATCH_H}
        fill="#fbbf24"
        fillOpacity={0.6}
        stroke="#b45309"
        strokeWidth={2}
      />
    </svg>
  );
}
