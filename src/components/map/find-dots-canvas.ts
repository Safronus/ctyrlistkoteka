import L from "leaflet";

/**
 * Non-interactive canvas overlay that paints every find as a tiny clover
 * dot. We avoid `L.circleMarker` and `divIcon` because at 17k+ items they
 * either tank framerate (DOM-heavy markers) or can't render a thematic
 * shape (plain canvas circles). One full-viewport canvas + a pre-rendered
 * sprite + a single drawImage per point keeps redraw under a few ms even
 * with future growth toward 100k.
 *
 * The shape mirrors the find-detail map pin: four overlapping circles in
 * brand green (#15803d) with a slightly darker centre disc (#0f6e34) for
 * readability against OSM tiles. Anonymized finds and finds without GPS
 * never make it into `coords` — the server query already filters them.
 */

/** Coord tuple per find — see MapData.findCoords JSDoc on the server
 *  for slot semantics. The 5th slot (deviated, 0/1) drives the
 *  optional "Skrýt odchýlené nálezy" filter under the Vrstvy → Nálezy
 *  toggle. */
type FindCoord = readonly [number, number, number, number, number];

// Sprite size in CSS pixels. Small enough to read as a dot at country
// scale, large enough to recognise the clover shape when zoomed in.
const SPRITE_SIZE = 10;
// Sprite is rendered into a slightly larger canvas to give the four
// circles room to "bloom" outside SPRITE_SIZE without being clipped.
const SPRITE_PAD = 1;
const SPRITE_BOX = SPRITE_SIZE + SPRITE_PAD * 2;
const COLOR = "#15803d";
const COLOR_CENTRE = "#0f6e34";
// Alpha applied to finds outside the currently bright set. Light enough
// to read as "secondary" while still hinting at density.
const DIM_ALPHA = 0.2;

interface FindDotsLayerOptions extends L.LayerOptions {
  coords: ReadonlyArray<FindCoord>;
  /** Location ids whose finds should paint at full opacity. When null
   *  every find is full-opacity (no focus active). When set, finds with
   *  matching location ids stay vivid; the rest fade. Lower priority
   *  than `highlightFindIds` — when both are set, the find-id filter
   *  takes precedence (the user came from a /sbirka filter, so that's
   *  the more specific intent). */
  focusFindIds: ReadonlySet<number> | null;
  /** Find ids to keep bright. Set when /mapa receives /sbirka filter
   *  params; the resulting set wins over `focusFindIds`. */
  highlightFindIds: ReadonlySet<number> | null;
  /** When true, finds whose `deviated` flag is set (GPS outside the
   *  polygon AOI, or beyond FIND_DEVIATION_RADIUS_M of the centre for
   *  polygon-less locations) are skipped entirely — they don't paint,
   *  not even dimmed. Used by the Vrstvy → Nálezy → "Skrýt odchýlené"
   *  sub-toggle to declutter the canvas of GPS outliers. */
  hideDeviated: boolean;
}

// We can't extend L.Layer directly here — `_map` is protected on the
// base type. Use a structural shape that mirrors what L.Layer.extend
// actually wires up at runtime, then `as unknown` to bridge the two.
type FindDotsLayerInstance = {
  _map: L.Map;
  _canvas: HTMLCanvasElement;
  _sprite: HTMLCanvasElement;
  _coords: ReadonlyArray<FindCoord>;
  _focusFindIds: ReadonlySet<number> | null;
  _highlightFindIds: ReadonlySet<number> | null;
  _hideDeviated: boolean;
  _dpr: number;
  _reset(): void;
  _redraw(): void;
  _animateZoom(e: L.ZoomAnimEvent): void;
};

const FindDotsLayer = L.Layer.extend({
  initialize(this: FindDotsLayerInstance, options: FindDotsLayerOptions) {
    L.Util.setOptions(this, options);
    this._coords = options.coords;
    this._focusFindIds = options.focusFindIds;
    this._highlightFindIds = options.highlightFindIds;
    this._hideDeviated = options.hideDeviated;
  },

  onAdd(this: FindDotsLayerInstance, map: L.Map) {
    this._map = map;
    this._dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;

    const canvas = L.DomUtil.create("canvas", "leaflet-find-dots leaflet-layer");
    canvas.style.pointerEvents = "none";
    // Match Leaflet's pane behaviour during zoom animation. Without
    // leaflet-zoom-animated the canvas would jump on zoom-in/out instead
    // of scaling smoothly with the rest of the overlay.
    L.DomUtil.addClass(canvas, "leaflet-zoom-animated");
    this._canvas = canvas;
    this._sprite = createSprite(this._dpr);

    // Custom pane keyed at z-index 550 — above overlayPane (400, where
    // location polygons + dots live) and below markerPane (600, where
    // the highlight marker lives). Without it, every polygon re-render
    // appended a fresh SVG to overlayPane and ended up painted on top
    // of the find canvas, hiding the green dots whenever the focus or
    // child-polygon set changed.
    const PANE_NAME = "ctyr-find-dots";
    if (!map.getPane(PANE_NAME)) {
      map.createPane(PANE_NAME);
    }
    const pane = map.getPane(PANE_NAME);
    if (pane) {
      pane.style.zIndex = "550";
      pane.style.pointerEvents = "none";
      pane.appendChild(canvas);
    } else {
      map.getPanes().overlayPane.appendChild(canvas);
    }
    map.on("moveend", this._reset, this);
    map.on("resize", this._reset, this);
    map.on("zoomanim", this._animateZoom, this);
    this._reset();
    return this;
  },

  onRemove(this: FindDotsLayerInstance, map: L.Map) {
    L.DomUtil.remove(this._canvas);
    map.off("moveend", this._reset, this);
    map.off("resize", this._reset, this);
    map.off("zoomanim", this._animateZoom, this);
  },

  _animateZoom(this: FindDotsLayerInstance, e: L.ZoomAnimEvent) {
    // During zoom Leaflet CSS-transforms the overlay pane. Mirror that
    // transform on the canvas so the dots scale with the basemap rather
    // than snapping after the animation ends.
    const map = this._map as L.Map & {
      _latLngBoundsToNewLayerBounds: (
        bounds: L.LatLngBounds,
        zoom: number,
        center: L.LatLng,
      ) => L.Bounds;
    };
    const scale = map.getZoomScale(e.zoom, map.getZoom());
    const offset = map._latLngBoundsToNewLayerBounds(
      map.getBounds(),
      e.zoom,
      e.center,
    ).min;
    if (!offset) return;
    L.DomUtil.setTransform(this._canvas, offset, scale);
  },

  _reset(this: FindDotsLayerInstance) {
    const map = this._map;
    const size = map.getSize();
    const topLeft = map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(this._canvas, topLeft);

    const dpr = this._dpr;
    const cssWidth = size.x;
    const cssHeight = size.y;
    if (this._canvas.width !== cssWidth * dpr) {
      this._canvas.width = cssWidth * dpr;
    }
    if (this._canvas.height !== cssHeight * dpr) {
      this._canvas.height = cssHeight * dpr;
    }
    this._canvas.style.width = `${cssWidth}px`;
    this._canvas.style.height = `${cssHeight}px`;

    this._redraw();
  },

  _redraw(this: FindDotsLayerInstance) {
    const ctx = this._canvas.getContext("2d");
    if (!ctx) return;

    const dpr = this._dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cssWidth = this._canvas.width / dpr;
    const cssHeight = this._canvas.height / dpr;
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const map = this._map;
    const topLeft = map.containerPointToLayerPoint([0, 0]);
    const bounds = map.getBounds();
    // Cheap lat/lng cull skips the layerPoint conversion for points well
    // outside the viewport. A small padding keeps sprites that overlap
    // the edge from popping in/out as the user pans.
    const pad = 0.005;
    const minLat = bounds.getSouth() - pad;
    const maxLat = bounds.getNorth() + pad;
    const minLng = bounds.getWest() - pad;
    const maxLng = bounds.getEast() + pad;

    const sprite = this._sprite;
    const half = SPRITE_BOX / 2;
    const coords = this._coords;
    // Pick the predicate ONCE before the hot loop:
    //   highlightFindIds (find IDs) wins when set — that's the more
    //     specific intent (visitor came from a /sbirka filter)
    //   focusFindIds (location IDs) is the fallback dim mode
    //   neither set → all bright, single pass
    const highlightFinds = this._highlightFindIds;
    const focusLocs = this._focusFindIds;
    const hideDeviated = this._hideDeviated;
    const isBright: ((c: FindCoord) => boolean) | null =
      highlightFinds !== null
        ? (c) => highlightFinds.has(c[3])
        : focusLocs !== null
          ? (c) => focusLocs.has(c[2])
          : null;
    // `Skrýt odchýlené` semantic:
    //   - No focus active → hide deviated finds across the whole
    //     catalog (the visitor wants a globally cleaner canvas).
    //   - Focus active (sidebar location picked, deep-link arrival)
    //     → only hide deviated AT the focused location's subtree;
    //     other locations' deviated stay visible (dimmed by the
    //     focus pass). Without this restriction the toggle was
    //     hiding finds outside the focus the visitor never asked
    //     to filter.
    const shouldHide = (c: FindCoord): boolean => {
      if (!hideDeviated || c[4] !== 1) return false;
      if (focusLocs === null) return true;
      return focusLocs.has(c[2]);
    };
    // Two-pass paint when a dim filter is active: dim ones first so the
    // bright dots end up on top. Single pass otherwise. This keeps
    // overlapping markers in dense clusters readable instead of a
    // bright dot disappearing under a later-iterated dim neighbour.
    // The `shouldHide` guard is checked FIRST in both branches —
    // hiding wins over both dim/bright passes since the goal is "don't
    // render at all".
    if (isBright !== null) {
      ctx.globalAlpha = DIM_ALPHA;
      for (let i = 0; i < coords.length; i++) {
        const c = coords[i];
        if (!c) continue;
        if (shouldHide(c)) continue;
        if (isBright(c)) continue;
        const lat = c[0];
        const lng = c[1];
        if (lat < minLat || lat > maxLat || lng < minLng || lng > maxLng) {
          continue;
        }
        const lp = map.latLngToLayerPoint([lat, lng]);
        const x = lp.x - topLeft.x - half;
        const y = lp.y - topLeft.y - half;
        ctx.drawImage(sprite, x, y, SPRITE_BOX, SPRITE_BOX);
      }
      ctx.globalAlpha = 1;
      for (let i = 0; i < coords.length; i++) {
        const c = coords[i];
        if (!c) continue;
        if (shouldHide(c)) continue;
        if (!isBright(c)) continue;
        const lat = c[0];
        const lng = c[1];
        if (lat < minLat || lat > maxLat || lng < minLng || lng > maxLng) {
          continue;
        }
        const lp = map.latLngToLayerPoint([lat, lng]);
        const x = lp.x - topLeft.x - half;
        const y = lp.y - topLeft.y - half;
        ctx.drawImage(sprite, x, y, SPRITE_BOX, SPRITE_BOX);
      }
      return;
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < coords.length; i++) {
      const c = coords[i];
      if (!c) continue;
      if (shouldHide(c)) continue;
      const lat = c[0];
      const lng = c[1];
      if (lat < minLat || lat > maxLat || lng < minLng || lng > maxLng) {
        continue;
      }
      const lp = map.latLngToLayerPoint([lat, lng]);
      const x = lp.x - topLeft.x - half;
      const y = lp.y - topLeft.y - half;
      ctx.drawImage(sprite, x, y, SPRITE_BOX, SPRITE_BOX);
    }
  },
});

export function createFindDotsLayer(
  coords: ReadonlyArray<FindCoord>,
  focusFindIds: ReadonlySet<number> | null,
  highlightFindIds: ReadonlySet<number> | null,
  hideDeviated: boolean,
): L.Layer {
  // L.Layer.extend returns an `any`-typed constructor by design; cast to
  // the typed instance shape we declared above.
  const Ctor = FindDotsLayer as unknown as new (
    options: FindDotsLayerOptions,
  ) => L.Layer;
  return new Ctor({ coords, focusFindIds, highlightFindIds, hideDeviated });
}

/**
 * Pre-renders the four-circle clover sprite once. Drawing this every
 * frame for thousands of points would dominate redraw time; rendering
 * once into an offscreen canvas lets the per-point work be a single
 * drawImage of a tiny bitmap.
 */
function createSprite(dpr: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SPRITE_BOX * dpr;
  canvas.height = SPRITE_BOX * dpr;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Layout mirrors the SVG pin in src/app/sbirka/[id]/page.tsx (32 px box,
  // r=5, offset=5 from centre). Scaled down to SPRITE_SIZE.
  const cx = SPRITE_BOX / 2;
  const cy = SPRITE_BOX / 2;
  const off = SPRITE_SIZE * 0.16;
  const leafR = SPRITE_SIZE * 0.32;
  const coreR = SPRITE_SIZE * 0.18;

  ctx.fillStyle = COLOR;
  for (const [dx, dy] of [
    [0, -off],
    [off, 0],
    [0, off],
    [-off, 0],
  ] as const) {
    ctx.beginPath();
    ctx.arc(cx + dx, cy + dy, leafR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = COLOR_CENTRE;
  ctx.beginPath();
  ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
  ctx.fill();

  return canvas;
}
