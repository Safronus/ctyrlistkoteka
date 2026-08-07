/**
 * Lenient parser for a hand-entered / pasted coordinate pair.
 *
 * Coordinates reach the drop admin from wherever the operator happens to
 * be standing: a phone's compass app, Mapy.cz, Google Maps, a photo's EXIF
 * readout, or this very site (which prints Apple-style DMS with CZECH
 * direction letters — S/J/V/Z, not N/S/E/W). Rejecting all but one of
 * those would mean retyping in the field, so the parser accepts the
 * common shapes and normalises them to signed decimal degrees.
 *
 * Accepted, in either lat-then-lng order-with-hemisphere or plain
 * lat, lng order:
 *   49.2245, 17.6712              decimal degrees
 *   49.2245 17.6712               (space or semicolon separated)
 *   49,2245  17,6712              decimal COMMA — only when a separate
 *                                 pair separator makes it unambiguous
 *   49°21'59.9"N 17°53'19.4"E     DMS, ASCII or typographic quotes
 *   49°21'59.9"S 17°53'19.4"V     DMS with Czech letters
 *   N 49° 21.998' E 17° 53.323'   degrees + decimal minutes
 *   49°21'59.9"N, 17°53'19.4"E    any of the above with a comma
 *   https://mapy.cz/…?x=17.67&y=49.22    a pasted map URL
 *
 * Returns null rather than throwing: every caller shows an inline error.
 */

export interface ParsedGps {
  lat: number;
  lng: number;
}

/** Czech direction letters alongside the English ones. J = jih (south),
 *  V = východ (east), Z = západ (west), S is NORTH in Czech but SOUTH in
 *  English — which is why hemisphere letters are only trusted together
 *  with the other letter of the pair (see `resolveHemispheres`). */
const NORTH = new Set(["N", "S"]); // S = sever (cs)
const SOUTH = new Set(["J"]); // jih
const EAST = new Set(["E", "V"]); // východ
const WEST = new Set(["W", "Z"]); // západ

/** Symbols that may separate the numbers of one component. */
const UNIT_CHARS = "°º'′’\"″”";
/** Linear, backtracking-free: one number at a time. Assembling the whole
 *  D°M'S" grammar into a single pattern made three linters shout about
 *  super-linear matching, and rightly — nested optional groups over the
 *  same character classes is exactly the ReDoS shape. Scanning the
 *  numbers out and looking at how many there are is both safer and
 *  easier to follow.
 *
 *  The `detect-unsafe-regex` warning on the line below is a false
 *  positive: backtracking out of `\d+` can never re-enter the optional
 *  group, because `[.,]` and `\d` share no character. Scoped disable
 *  rather than a looser pattern, so the intent stays readable. */
// eslint-disable-next-line security/detect-unsafe-regex
const NUMBER = /-?\d+(?:[.,]\d+)?/g;

function num(raw: string | undefined): number {
  return raw === undefined ? 0 : Number(raw.replace(",", "."));
}

interface Component {
  value: number;
  letter: string | null;
}

/**
 * Reads one half of a coordinate pair: an optional hemisphere letter at
 * either end, then one to three numbers meaning degrees, minutes and
 * seconds.
 */
function parseComponent(raw: string): Component | null {
  let text = raw.trim();
  if (!text) return null;

  let letter: string | null = null;
  const first = text[0]!.toUpperCase();
  const last = text[text.length - 1]!.toUpperCase();
  if ("NSEWJVZ".includes(first)) {
    letter = first;
    text = text.slice(1);
  } else if ("NSEWJVZ".includes(last)) {
    letter = last;
    text = text.slice(0, -1);
  }

  NUMBER.lastIndex = 0;
  const numbers = text.match(NUMBER) ?? [];
  if (numbers.length === 0 || numbers.length > 3) return null;

  // Whatever is left once the numbers and their unit marks are removed
  // must be nothing — that is what rejects "kdesi u lesa".
  let rest = text;
  for (const n of numbers) rest = rest.replace(n, " ");
  for (const ch of UNIT_CHARS) rest = rest.split(ch).join(" ");
  if (rest.trim() !== "") return null;

  const deg = num(numbers[0]);
  const minutes = numbers.length > 1 ? num(numbers[1]) : 0;
  const seconds = numbers.length > 2 ? num(numbers[2]) : 0;
  if (!Number.isFinite(deg)) return null;
  if (minutes >= 60 || seconds >= 60 || minutes < 0 || seconds < 0) return null;

  const magnitude = Math.abs(deg) + minutes / 60 + seconds / 3600;
  return { value: deg < 0 ? -magnitude : magnitude, letter };
}

/**
 * Works out which component is latitude and applies the hemisphere signs.
 *
 * The ambiguity that matters: Czech "S" means north, English "S" means
 * south. It is resolved by looking at the PAIR — if the other component
 * says V/Z (Czech east/west) the whole pair is Czech, so S is north. With
 * an English E/W the pair is English and S is south. With no letters at
 * all the order is assumed lat, lng, which is what every source above
 * prints.
 */
function resolveHemispheres(a: Component, b: Component): ParsedGps | null {
  const letters = [a.letter, b.letter].filter(Boolean) as string[];
  const czech = letters.some((l) => l === "J" || l === "V" || l === "Z");

  const axis = (c: Component): "lat" | "lng" | null => {
    if (c.letter === null) return null;
    if (c.letter === "N" || c.letter === "J") return "lat";
    if (c.letter === "E" || c.letter === "W" || c.letter === "V") return "lng";
    if (c.letter === "Z") return "lng";
    // "S" — north in Czech, south in English; either way a latitude.
    if (c.letter === "S") return "lat";
    return null;
  };

  const sign = (c: Component): number => {
    if (c.letter === null) return c.value < 0 ? -1 : 1;
    if (SOUTH.has(c.letter)) return -1;
    if (WEST.has(c.letter)) return -1;
    if (c.letter === "S") return czech ? 1 : -1; // sever vs south
    if (NORTH.has(c.letter) || EAST.has(c.letter)) return 1;
    return 1;
  };

  const axisA = axis(a);
  const axisB = axis(b);
  let latC = a;
  let lngC = b;
  if (axisA === "lng" || axisB === "lat") {
    latC = b;
    lngC = a;
  } else if (axisA === null && axisB === null) {
    // no letters — plain "lat, lng"
  }

  const lat = Math.abs(latC.value) * sign(latC);
  const lng = Math.abs(lngC.value) * sign(lngC);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/** Pulls coordinates out of a pasted map URL (mapy.cz `x`/`y`, Google's
 *  `@lat,lng`, or a `q=`/`ll=` parameter). */
function fromUrl(input: string): ParsedGps | null {
  if (!/^https?:\/\//i.test(input)) return null;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  const x = url.searchParams.get("x");
  const y = url.searchParams.get("y");
  if (x && y) {
    const lat = Number(y);
    const lng = Number(x);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  for (const key of ["ll", "q", "query", "center"]) {
    const v = url.searchParams.get(key);
    if (v) {
      const p = parseGps(v);
      if (p) return p;
    }
  }
  const at = /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(url.href);
  if (at) return { lat: Number(at[1]), lng: Number(at[2]) };
  return null;
}

export function parseGps(input: string): ParsedGps | null {
  const raw = input.trim();
  if (!raw) return null;

  const viaUrl = fromUrl(raw);
  if (viaUrl) return viaUrl;

  // Split into two components. A comma is the usual pair separator, but it
  // is also the Czech decimal mark — so a single comma between two integers
  // that look like one number ("49,2245 17,6712") must NOT split there.
  // Strategy: prefer splitting on a separator that leaves exactly two
  // parseable components.
  const candidates: Array<[string, string]> = [];
  const push = (parts: string[]) => {
    if (parts.length === 2 && parts[0]!.trim() && parts[1]!.trim()) {
      candidates.push([parts[0]!, parts[1]!]);
    }
  };
  push(raw.split(";"));
  push(raw.split(/,(?=\s)/)); // comma followed by space → pair separator
  push(raw.split(","));
  // Whitespace split: join back around the midpoint so "N 49° 21.9' E 17°"
  // still yields two halves, using the second direction letter as the seam.
  const seam = raw.search(/\s(?=[NSEWJVZ]\s*\d)|(?<=[NSEWJVZ])\s+(?=\d)/iu);
  const eastWest = raw.search(/(?<=[°'"″’”\d])\s*[EWVZ]\b/iu);
  if (eastWest > 0) {
    // Everything up to and including the east/west letter belongs together
    // only when that letter TRAILS its number; otherwise it leads the second
    // component. Try both seams.
    push([raw.slice(0, eastWest), raw.slice(eastWest)]);
    const after = raw.indexOf(" ", eastWest);
    if (after > 0) push([raw.slice(0, after), raw.slice(after)]);
  }
  if (seam > 0) push([raw.slice(0, seam), raw.slice(seam)]);
  const ws = raw.split(/\s+/);
  if (ws.length === 2) push(ws);
  if (ws.length === 4) push([ws.slice(0, 2).join(" "), ws.slice(2).join(" ")]);
  if (ws.length === 6) push([ws.slice(0, 3).join(" "), ws.slice(3).join(" ")]);

  for (const [left, right] of candidates) {
    const a = parseComponent(left);
    const b = parseComponent(right);
    if (!a || !b) continue;
    const out = resolveHemispheres(a, b);
    if (out) return out;
  }
  return null;
}

/** Canonical form written back into the xlsx export and the admin inputs:
 *  signed decimal degrees with 6 places (~0.1 m), unambiguous everywhere. */
export function formatGpsDecimal(lat: number, lng: number): string {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}
