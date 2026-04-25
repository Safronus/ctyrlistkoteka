/**
 * Pure DMS formatters — server-safe so they can be reused by both the
 * client GpsValue component and server-rendered list rows.
 *
 *   apple:   49°21'46.8"N 17°53'42.0"E      (Apple Maps style)
 *   verbose: N 49° 21' 56.530" E 17° 53' 21.120"
 */

export function formatGpsApple(lat: number, lng: number): string {
  return `${toAppleDms(lat, true)} ${toAppleDms(lng, false)}`;
}

export function formatGpsVerbose(lat: number, lng: number): string {
  return `${toVerboseDms(lat, true)} ${toVerboseDms(lng, false)}`;
}

function toAppleDms(deg: number, isLat: boolean): string {
  const { d, m, s } = toDmsParts(deg);
  const dir = direction(deg, isLat);
  const ss = padSeconds(s, 1);
  const mm = String(m).padStart(2, "0");
  return `${d}°${mm}'${ss}"${dir}`;
}

function toVerboseDms(deg: number, isLat: boolean): string {
  const { d, m, s } = toDmsParts(deg);
  const dir = direction(deg, isLat);
  const ss = padSeconds(s, 3);
  const mm = String(m).padStart(2, "0");
  return `${dir} ${d}° ${mm}' ${ss}"`;
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

function direction(deg: number, isLat: boolean): string {
  if (isLat) return deg >= 0 ? "N" : "S";
  return deg >= 0 ? "E" : "W";
}
