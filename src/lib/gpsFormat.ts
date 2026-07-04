/**
 * Pure DMS/DDM/DD/UTM formatters — server-safe so they can be reused by
 * both the client GpsValue component and server-rendered list rows.
 *
 *   apple:   49°14'09.9"S 17°40'19.0"V         (Apple Maps style, suffix dir)
 *   verbose: S 49°14'09.870" V 17°40'18.970"   (prefix dir, more decimals)
 *   ddm:     S 49° 14.165 V 017° 40.316         (degrees + decimal minutes)
 *   dd:      49.236075, 17.671936               (signed decimal — Google)
 *   utm:     33U 476123 5455678                 (UTM / WGS84)
 *
 * Direction letters localise: Czech uses S/J/V/Z (Sever/Jih/Východ/Západ)
 * instead of N/S/E/W. `locale` is optional — omit it (or pass anything but
 * "cs") to keep the English N/S/E/W letters.
 */

export type GpsFormat = "apple" | "verbose" | "ddm" | "dd" | "utm";

/** Cycle order for the GpsValue toggle. */
export const GPS_FORMATS: readonly GpsFormat[] = [
  "apple",
  "verbose",
  "ddm",
  "dd",
  "utm",
];

const CS_DIRS = { N: "S", S: "J", E: "V", W: "Z" } as const;
const EN_DIRS = { N: "N", S: "S", E: "E", W: "W" } as const;

function direction(deg: number, isLat: boolean, locale?: string): string {
  const d = locale === "cs" ? CS_DIRS : EN_DIRS;
  if (isLat) return deg >= 0 ? d.N : d.S;
  return deg >= 0 ? d.E : d.W;
}

/** Dispatch a (lat, lng) pair to the requested format. */
export function formatGps(
  format: GpsFormat,
  lat: number,
  lng: number,
  locale?: string,
): string {
  switch (format) {
    case "verbose":
      return formatGpsVerbose(lat, lng, locale);
    case "ddm":
      return formatGpsDdm(lat, lng, locale);
    case "dd":
      return formatGpsDdSigned(lat, lng);
    case "utm":
      return formatGpsUtm(lat, lng);
    case "apple":
    default:
      return formatGpsApple(lat, lng, locale);
  }
}

export function formatGpsApple(
  lat: number,
  lng: number,
  locale?: string,
): string {
  return `${toAppleDms(lat, true, locale)} ${toAppleDms(lng, false, locale)}`;
}

export function formatGpsVerbose(
  lat: number,
  lng: number,
  locale?: string,
): string {
  return `${toVerboseDms(lat, true, locale)} ${toVerboseDms(lng, false, locale)}`;
}

/** Degrees + decimal minutes, direction prefix, zero-padded degrees
 *  (lat 2 digits, lng 3): "S 49° 14.165 V 017° 40.316". */
export function formatGpsDdm(
  lat: number,
  lng: number,
  locale?: string,
): string {
  return `${toDdm(lat, true, locale)} ${toDdm(lng, false, locale)}`;
}

/** Signed decimal degrees — copy-paste into Google Maps / a URL. */
export function formatGpsDdSigned(lat: number, lng: number): string {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

function toAppleDms(deg: number, isLat: boolean, locale?: string): string {
  const { d, m, s } = toDmsParts(deg);
  const dir = direction(deg, isLat, locale);
  const ss = padSeconds(s, 1);
  const mm = String(m).padStart(2, "0");
  return `${d}°${mm}'${ss}"${dir}`;
}

function toVerboseDms(deg: number, isLat: boolean, locale?: string): string {
  const { d, m, s } = toDmsParts(deg);
  const dir = direction(deg, isLat, locale);
  const ss = padSeconds(s, 3);
  const mm = String(m).padStart(2, "0");
  return `${dir} ${d}°${mm}'${ss}"`;
}

function toDdm(deg: number, isLat: boolean, locale?: string): string {
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const min = (abs - d) * 60;
  const dir = direction(deg, isLat, locale);
  const dd = String(d).padStart(isLat ? 2 : 3, "0");
  const [intPart, decPart] = min.toFixed(3).split(".");
  const mmm = `${(intPart ?? "0").padStart(2, "0")}.${decPart}`;
  return `${dir} ${dd}° ${mmm}`;
}

function toDmsParts(deg: number): { d: number; m: number; s: number } {
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const minTotal = (abs - d) * 60;
  const m = Math.floor(minTotal);
  const s = (minTotal - m) * 60;
  return { d, m, s };
}

function padSeconds(s: number, decimals: number): string {
  const fixed = s.toFixed(decimals);
  // Pad integer part to 2 digits so "9.5" → "09.5"
  const [intPart, decPart] = fixed.split(".");
  const padded = (intPart ?? "0").padStart(2, "0");
  return decPart ? `${padded}.${decPart}` : padded;
}

/**
 * WGS84 → UTM. Returns "zone + band easting northing" (metres, rounded),
 * e.g. "33U 476123 5455678". Standard Transverse Mercator series (Snyder),
 * accurate to well under a metre for the collection's latitudes.
 */
export function formatGpsUtm(lat: number, lng: number): string {
  const a = 6378137.0; // WGS84 semi-major axis
  const f = 1 / 298.257223563; // flattening
  const k0 = 0.9996;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);

  const zone = Math.floor((lng + 180) / 6) + 1;
  const lonOrigin = (zone - 1) * 6 - 180 + 3;
  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lng * Math.PI) / 180;
  const lonOriginRad = (lonOrigin * Math.PI) / 180;

  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const tanLat = Math.tan(latRad);
  const N = a / Math.sqrt(1 - e2 * sinLat * sinLat);
  const T = tanLat * tanLat;
  const C = ep2 * cosLat * cosLat;
  const A = cosLat * (lonRad - lonOriginRad);
  const M =
    a *
    ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * latRad -
      ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) *
        Math.sin(2 * latRad) +
      ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * latRad) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * latRad));

  const easting =
    k0 *
      N *
      (A +
        ((1 - T + C) * A ** 3) / 6 +
        ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120) +
    500000;
  let northing =
    k0 *
    (M +
      N *
        tanLat *
        (A ** 2 / 2 +
          ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24 +
          ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720));
  if (lat < 0) northing += 10000000;

  return `${zone}${utmBand(lat)} ${Math.round(easting)} ${Math.round(northing)}`;
}

/** UTM latitude band letter (C–X, skipping I and O). */
function utmBand(lat: number): string {
  if (lat < -80 || lat > 84) return "";
  const bands = "CDEFGHJKLMNPQRSTUVWX";
  const idx = Math.min(Math.floor((lat + 80) / 8), bands.length - 1);
  return bands[idx] ?? "";
}
