import { DropStatus } from "@/generated/prisma/enums";
import type { QrDensity } from "@/lib/admin/qrDensity";
import { printableSiteUrl } from "@/lib/printableSiteUrl";

/**
 * Pure vocabulary of the drop-campaign domain — labels, tones, the option
 * bag and the scatter maths.
 *
 * Split out of `drops.ts` because the ADMIN GRID is a client component and
 * needs the status labels: importing them from the server-side module
 * dragged Prisma (and through it `pg`, and through that `dns`) into the
 * browser bundle and broke the build. Same trap as qrDensity vs qr.ts.
 */

/** Czech labels for the lifecycle, in journey order. */
export const DROP_STATUS_LABEL: Record<DropStatus, string> = {
  PREPARED: "Připravený",
  PRINTED: "Vytištěný",
  HIDDEN: "Schovaný",
  FOUND: "Nalezený",
};

export const DROP_STATUS_ORDER: DropStatus[] = [
  DropStatus.PREPARED,
  DropStatus.PRINTED,
  DropStatus.HIDDEN,
  DropStatus.FOUND,
];

/** Marker / badge tone per status, so the map and the list agree. */
export const DROP_STATUS_TONE: Record<DropStatus, string> = {
  PREPARED: "bg-gray-100 text-gray-700",
  PRINTED: "bg-amber-100 text-amber-900",
  HIDDEN: "bg-sky-100 text-sky-900",
  FOUND: "bg-brand-100 text-brand-800",
};

/** Hex colours for the map markers — same order as above. */
export const DROP_STATUS_COLOR: Record<DropStatus, string> = {
  PREPARED: "#9ca3af",
  PRINTED: "#d97706",
  HIDDEN: "#0284c7",
  FOUND: "#16a34a",
};

/** The QR render options a campaign or item may carry. Stored as JSON so
 *  the option bag can grow without a migration; every field is optional
 *  and validated on read. */
export interface DropQrOptions {
  density?: QrDensity;
  theme?: string;
  moduleStyle?: string;
  center?: string;
  centerScale?: string;
  border?: string;
  borderRadius?: string;
  borderColor?: string;
  /** Printed width of the whole card in centimetres. Lives in the option
   *  bag rather than its own column so it inherits campaign → item for
   *  free, like every other look setting. */
  sizeCm?: number;
  /** WHETHER there is a line above the code; `qrTitle` says what it reads.
   *  Two fields because an empty text cannot mean both "use the find
   *  number" and "print nothing" at once — which is exactly the gap that
   *  made "no title at all" impossible to ask for. */
  titleMode?: DropTitleMode;
  /** Same split for the line under the code. */
  captionMode?: DropCaptionMode;
}

/** `find` = the automatic „🍀 #<číslo>“, `custom` = whatever `qrTitle`
 *  holds, `none` = nothing above the code. */
export type DropTitleMode = "find" | "custom" | "none";
export type DropCaptionMode = "custom" | "none";

export const DROP_TITLE_MODE_LABEL: Record<DropTitleMode, string> = {
  find: "Číslo nálezu",
  custom: "Vlastní text",
  none: "Bez textu",
};

export const DROP_CAPTION_MODE_LABEL: Record<DropCaptionMode, string> = {
  custom: "Vlastní text",
  none: "Bez textu",
};

/**
 * What actually gets printed above and below one card's code.
 *
 * The single place that resolves mode + text + inheritance, so the grid
 * preview, the single preview and the print sheet cannot disagree about
 * whether a card has a title.
 */
export function resolveQrLines(
  opts: DropQrOptions,
  findId: number,
  itemTitle: string | null,
  campaignTitle: string | null,
  itemCaption: string | null,
  campaignCaption: string | null,
): { title: string | null; caption: string | null } {
  const titleMode = opts.titleMode ?? "find";
  const captionMode = opts.captionMode ?? "custom";
  const title =
    titleMode === "none"
      ? null
      : titleMode === "custom"
        ? (itemTitle ?? campaignTitle ?? `🍀 #${findId}`)
        : `🍀 #${findId}`;
  const caption =
    captionMode === "none" ? null : (itemCaption ?? campaignCaption ?? null);
  return { title, caption };
}

/** Printed-width bounds, shared by the form, the option reader and the
 *  sheet layout. The floor is where a UUID landing code stops being
 *  readable by a phone; the ceiling is a card that no longer fits an A4
 *  grid usefully. */
export const DROP_SIZE_MIN_CM = 2;
export const DROP_SIZE_MAX_CM = 12;
export const DROP_SIZE_DEFAULT_CM = 4;

/** Clamps to the printable range; anything unparseable falls back to the
 *  default rather than to zero, which would render an invisible card. */
export function clampDropSizeCm(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(DROP_SIZE_MAX_CM, Math.max(DROP_SIZE_MIN_CM, n));
}

function pickOne<T extends string>(
  v: unknown,
  allowed: readonly T[],
): T | undefined {
  return typeof v === "string" && (allowed as readonly string[]).includes(v)
    ? (v as T)
    : undefined;
}

/** Coerces whatever is in the JSON column into a known-good option bag. */
export function readDropQrOptions(raw: unknown): DropQrOptions {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  return {
    density: pickOne(o.density, ["dense", "medium", "compact"] as const),
    theme: pickOne(o.theme, ["brand", "classic", "dark"] as const),
    moduleStyle: pickOne(o.moduleStyle, ["clover", "square", "dot"] as const),
    center: pickOne(o.center, ["clover", "smiley", "none"] as const),
    centerScale: pickOne(o.centerScale, ["sm", "md"] as const),
    border: pickOne(o.border, ["none", "frame", "panel", "cut"] as const),
    borderRadius: pickOne(o.borderRadius, ["soft", "round"] as const),
    borderColor: pickOne(o.borderColor, ["theme", "gray"] as const),
    sizeCm: clampDropSizeCm(o.sizeCm),
    titleMode: pickOne(o.titleMode, ["find", "custom", "none"] as const),
    captionMode: pickOne(o.captionMode, ["custom", "none"] as const),
  };
}

/** Campaign default under the item's override, field by field. */
export function mergeDropQrOptions(
  campaign: unknown,
  item: unknown,
): DropQrOptions {
  const base = readDropQrOptions(campaign);
  const over = readDropQrOptions(item);
  return { ...base, ...stripUndefined(over) };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** Public URL a card's QR encodes. Scheme is forced by
 *  `printableSiteUrl` — this ends up printed on a laminated card. */
export function dropLandingUrl(token: string): string {
  return `${printableSiteUrl()}/d/${token}`;
}

/**
 * Scatters points uniformly inside a circle.
 *
 * `sqrt` on the radius is what makes it uniform by AREA — without it the
 * points bunch up around the centre, which for a hundred hiding places
 * spread over a town would look obviously artificial.
 */
export function scatterPoints(
  centerLat: number,
  centerLng: number,
  radiusM: number,
  count: number,
  random: () => number = Math.random,
): Array<{ lat: number; lng: number }> {
  const out: Array<{ lat: number; lng: number }> = [];
  const latRad = (centerLat * Math.PI) / 180;
  const mPerDegLat = 111_132;
  const mPerDegLng = 111_320 * Math.cos(latRad);
  for (let i = 0; i < count; i++) {
    const angle = random() * 2 * Math.PI;
    const dist = Math.sqrt(random()) * radiusM;
    out.push({
      lat: centerLat + (dist * Math.sin(angle)) / mPerDegLat,
      lng:
        centerLng +
        (dist * Math.cos(angle)) / (mPerDegLng === 0 ? 1 : mPerDegLng),
    });
  }
  return out;
}
