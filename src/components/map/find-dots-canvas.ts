import L from "leaflet";
import { MAP_FIND_ICON_BASE_PX } from "@/lib/constants";

/**
 * Non-interactive canvas overlay that paints every find as a tiny clover
 * dot. We avoid `L.circleMarker` and `divIcon` because at 17k+ items they
 * either tank framerate (DOM-heavy markers) or can't render a thematic
 * shape (plain canvas circles). One full-viewport canvas + a few
 * pre-rendered sprites + a single drawImage per point keeps redraw under a
 * few ms even with future growth toward 100k.
 *
 * The shape mirrors the find-detail map pin: four overlapping circles with a
 * slightly darker centre disc for readability against OSM tiles. Colour
 * encodes the find's location-offset tone (slot [4]) — the SAME green /
 * amber / rose bands as /sbirka + the find detail: green = at the location,
 * amber = off but inside a location-map bbox, rose = outside every map.
 * Anonymized finds and finds without GPS never make it into `coords` — the
 * server query already filters them.
 */

/** Coord tuple per find — see MapData.findCoords JSDoc on the server for
 *  slot semantics. Slot [4] is the offset TONE: 0 = green (at location),
 *  1 = amber (deviated but within a location map), 2 = rose (deviated,
 *  outside all maps). Any tone ≥ 1 counts as "deviated" for the
 *  "Skrýt odchýlené nálezy" filter. */
type FindCoord = readonly [number, number, number, number, number];

// Default sprite size in CSS pixels (the "1×" the size slider centres on).
// Small enough to read as a dot at country scale, large enough to
// recognise the clover shape when zoomed in. Single source lives in
// constants.ts; mapa-shell always passes an explicit `spriteSize`, so this
// only backstops a bare createFindDotsLayer() call.
const DEFAULT_SPRITE_SIZE = MAP_FIND_ICON_BASE_PX;
// Sprite is rendered into a slightly larger canvas (× this factor) to give
// the four circles room to "bloom" outside the nominal size without clipping.
const SPRITE_PAD_RATIO = 0.1;
// Per-tone { leaf, centre } fills. Green mirrors the find-detail pin; amber
// and rose match Tailwind amber-500/700 and rose-500/700 so a dot's colour
// on the map matches the same find's offset dot on /sbirka.
const TONE_COLORS: ReadonlyArray<{ leaf: string; centre: string }> = [
  { leaf: "#15803d", centre: "#0f6e34" }, // 0 green — at the location
  { leaf: "#f59e0b", centre: "#b45309" }, // 1 amber — within a location map
  { leaf: "#f43f5e", centre: "#be123c" }, // 2 rose  — outside all maps
];
// Alpha applied to finds outside the currently bright set. Light enough
// to read as "secondary" while still hinting at density.
const DIM_ALPHA = 0.2;

interface FindDotsLayerOptions extends L.LayerOptions {
  coords: ReadonlyArray<FindCoord>;
  /** Location ids whose finds should paint at full opacity. When null
   *  every find is full-opacity (no focus active). When set, finds with
   *  matching location ids stay vivid; the rest fade. Lower priority
   *  than `highlightFindIds`. */
  focusFindIds: ReadonlySet<number> | null;
  /** Find ids to keep bright. Set when /mapa receives /sbirka filter
   *  params; the resulting set wins over `focusFindIds`. */
  highlightFindIds: ReadonlySet<number> | null;
  /** When true, finds whose tone (slot [4]) is ≥ 1 (deviated: outside the
   *  polygon AOI, or beyond FIND_DEVIATION_RADIUS_M of the centre) are
   *  skipped entirely — the Vrstvy → Nálezy → "Skrýt odchýlené" sub-toggle. */
  hideDeviated: boolean;
  /** When true, deviated finds paint amber/rose per their tone; when false
   *  every find paints green (the "Barevně odlišit odchýlené" toggle). */
  showDeviationColors: boolean;
  /** Sprite size in CSS pixels (the size slider). Defaults to
   *  DEFAULT_SPRITE_SIZE. */
  spriteSize: number;
}

// We can't extend L.Layer directly here — `_map` is protected on the
// base type. Use a structural shape that mirrors what L.Layer.extend
// actually wires up at runtime, then `as unknown` to bridge the two.
type FindDotsLayerInstance = {
  _map: L.Map;
  _canvas: HTMLCanvasElement;
  /** One pre-rendered sprite per tone (green / amber / rose). */
  _sprites: HTMLCanvasElement[];
  _coords: ReadonlyArray<FindCoord>;
  _focusFindIds: ReadonlySet<number> | null;
  _highlightFindIds: ReadonlySet<number> | null;
  _hideDeviated: boolean;
  _showColors: boolean;
  _spriteSize: number;
  _spriteBox: number;
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
    this._showColors = options.showDeviationColors;
    this._spriteSize = options.spriteSize;
    this._spriteBox = options.spriteSize * (1 + SPRITE_PAD_RATIO * 2);
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
    this._sprites = TONE_COLORS.map((c) =>
      createSprite(
        this._dpr,
        this._spriteSize,
        this._spriteBox,
        c.leaf,
        c.centre,
      ),
    );

    // Custom pane keyed at z-index 550 — above overlayPane (400, where
    // location polygons + dots live) and below markerPane (600, where
    // the highlight marker lives).
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

    const sprites = this._sprites;
    const green = sprites[0];
    // `sprites` always holds the three tone bitmaps (built in onAdd); this
    // guard only satisfies noUncheckedIndexedAccess and bails on the
    // impossible empty case.
    if (!green) return;
    const box = this._spriteBox;
    const half = box / 2;
    const coords = this._coords;
    const showColors = this._showColors;
    // Pick the sprite for a find: green unless colours are on AND the find
    // is deviated (tone ≥ 1), in which case amber (1) or rose (2).
    const spriteFor = (c: FindCoord): HTMLCanvasElement =>
      showColors && c[4] >= 1 ? (sprites[c[4]] ?? green) : green;
    // Pick the dim predicate ONCE before the hot loop.
    const highlightFinds = this._highlightFindIds;
    const focusLocs = this._focusFindIds;
    const hideDeviated = this._hideDeviated;
    const isBright: ((c: FindCoord) => boolean) | null =
      highlightFinds !== null
        ? (c) => highlightFinds.has(c[3])
        : focusLocs !== null
          ? (c) => focusLocs.has(c[2])
          : null;
    // `Skrýt odchýlené` semantic (tone ≥ 1 = deviated):
    //   - No focus active → hide deviated finds across the whole catalog.
    //   - Focus active → only hide deviated AT the focused location's
    //     subtree; other locations' deviated stay visible (dimmed).
    const shouldHide = (c: FindCoord): boolean => {
      if (!hideDeviated || c[4] < 1) return false;
      if (focusLocs === null) return true;
      return focusLocs.has(c[2]);
    };

    const paint = (c: FindCoord) => {
      const lat = c[0];
      const lng = c[1];
      if (lat < minLat || lat > maxLat || lng < minLng || lng > maxLng) return;
      const lp = map.latLngToLayerPoint([lat, lng]);
      const x = lp.x - topLeft.x - half;
      const y = lp.y - topLeft.y - half;
      ctx.drawImage(spriteFor(c), x, y, box, box);
    };

    // Two-pass paint when a dim filter is active: dim ones first so the
    // bright dots end up on top. Single pass otherwise.
    if (isBright !== null) {
      ctx.globalAlpha = DIM_ALPHA;
      for (let i = 0; i < coords.length; i++) {
        const c = coords[i];
        if (!c || shouldHide(c) || isBright(c)) continue;
        paint(c);
      }
      ctx.globalAlpha = 1;
      for (let i = 0; i < coords.length; i++) {
        const c = coords[i];
        if (!c || shouldHide(c) || !isBright(c)) continue;
        paint(c);
      }
      return;
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < coords.length; i++) {
      const c = coords[i];
      if (!c || shouldHide(c)) continue;
      paint(c);
    }
  },
});

export function createFindDotsLayer(
  coords: ReadonlyArray<FindCoord>,
  focusFindIds: ReadonlySet<number> | null,
  highlightFindIds: ReadonlySet<number> | null,
  hideDeviated: boolean,
  showDeviationColors: boolean,
  spriteSize: number = DEFAULT_SPRITE_SIZE,
): L.Layer {
  const Ctor = FindDotsLayer as unknown as new (
    options: FindDotsLayerOptions,
  ) => L.Layer;
  return new Ctor({
    coords,
    focusFindIds,
    highlightFindIds,
    hideDeviated,
    showDeviationColors,
    spriteSize,
  });
}

/**
 * Pre-renders one four-circle clover sprite (in the given leaf / centre
 * colours) once. Drawing this every frame for thousands of points would
 * dominate redraw time; rendering once into an offscreen canvas lets the
 * per-point work be a single drawImage of a tiny bitmap.
 */
function createSprite(
  dpr: number,
  spriteSize: number,
  spriteBox: number,
  leaf: string,
  centre: string,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = spriteBox * dpr;
  canvas.height = spriteBox * dpr;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const cx = spriteBox / 2;
  const cy = spriteBox / 2;
  const off = spriteSize * 0.16;
  const leafR = spriteSize * 0.32;
  const coreR = spriteSize * 0.18;

  ctx.fillStyle = leaf;
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
  ctx.fillStyle = centre;
  ctx.beginPath();
  ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
  ctx.fill();

  return canvas;
}
