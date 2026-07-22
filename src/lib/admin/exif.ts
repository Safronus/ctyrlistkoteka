/**
 * Shared EXIF reader for the sync pipeline AND the admin upload routes.
 *
 * Used twice in the data flow:
 *
 *  1. `scripts/sync.ts` — reads on-disk photos and writes `Find.foundAt`
 *     + GPS columns into the DB. Source of truth for the public site.
 *  2. `src/app/admin/api/upload/{finds,crops}/route.ts` — inspects every
 *     uploaded file immediately after `atomicWrite()` and surfaces a
 *     warning back to the operator if the photo is missing EXIF
 *     DateTimeOriginal. Lets the operator notice the problem during
 *     upload, not days later after running sync.
 *
 * Both consumers want the same forgiving "never throw, return nulls on
 * trouble" behaviour — a malformed EXIF block must not abort a sync run
 * mid-batch, and must not reject an otherwise valid upload either.
 *
 * **Do not import this module from a client component.** It uses the
 * `exifr` npm package which pulls in Node-only buffer/stream APIs that
 * Webpack can't bundle for the browser.
 */

export interface ExifSummary {
  /** Coalesced from DateTimeOriginal / DateTimeDigitized / CreateDate /
   *  ModifyDate. `null` when no field carried a parseable date. */
  dateTaken: Date | null;
  /** True if the chosen `dateTaken` carries a non-zero clock component
   *  (i.e. HH:MM:SS not all zero). False when EXIF only stores a date. */
  dateTakenHasClock: boolean;
  /** Decimal degrees, auto-unwrapped from exifr's GPS fields when present. */
  lat: number | null;
  lng: number | null;
}

const EMPTY: ExifSummary = {
  dateTaken: null,
  dateTakenHasClock: false,
  lat: null,
  lng: null,
};

interface RawExif {
  DateTimeOriginal?: Date | string;
  DateTimeDigitized?: Date | string;
  CreateDate?: Date | string;
  ModifyDate?: Date | string;
  latitude?: number;
  longitude?: number;
  GPSLatitude?: number | number[];
  GPSLongitude?: number | number[];
  GPSLatitudeRef?: string;
  GPSLongitudeRef?: string;
}

/**
 * Runs exifr against a path, falling back to an explicit Buffer read.
 *
 * exifr ships a UMD build that sniffs the environment at runtime to decide
 * whether it may touch `fs`. A bundler (Next's server webpack) can mangle
 * that detection, after which passing a *path* throws and every caller
 * silently sees "no EXIF" — which is exactly what made every admin upload
 * report a missing DateTimeOriginal for photos that had one. `exifr` is now
 * in `serverExternalPackages` so the detection stays intact, and this
 * fallback keeps the reader correct even if that config is ever lost.
 *
 * The fallback only runs on the error path, so sync's 17k-photo run keeps
 * exifr's cheap chunked head-read instead of loading each file whole.
 */
async function parseExif(path: string): Promise<RawExif | undefined> {
  const mod = await import("exifr");
  // `.default` is undefined under some CJS/ESM interop shapes — fall back to
  // the namespace object itself rather than throwing on `.parse`.
  const exifr = (mod.default ?? mod) as {
    parse: (input: string | Buffer) => Promise<RawExif | undefined>;
  };
  try {
    return await exifr.parse(path);
  } catch (err) {
    const { readFile } = await import("node:fs/promises");
    console.warn("[exif] path read failed, retrying via Buffer", {
      path,
      message: (err as Error).message,
    });
    return await exifr.parse(await readFile(path));
  }
}

export async function readExifSafe(path: string): Promise<ExifSummary> {
  try {
    // Default options give us EXIF + GPS with auto-unwrapping into top-level
    // `latitude` / `longitude`. `pick` was previously used here together
    // with `gps: true` and that combination filters output keys BEFORE the
    // GPS unwrap step — leaving us with empty results. Always read the full
    // default set; we filter to just the keys we need below.
    const exif = await parseExif(path);
    if (!exif) return EMPTY;

    // Try every plausible EXIF date field, then prefer the first candidate
    // that actually carries a clock component — some pipelines (older
    // exiftool / heic-convert / WhatsApp etc.) strip the time portion of
    // DateTimeOriginal but leave it intact in CreateDate, or vice versa.
    const candidates = [
      exif.DateTimeOriginal,
      exif.DateTimeDigitized,
      exif.CreateDate,
      exif.ModifyDate,
    ]
      .map(toDate)
      .filter((d): d is Date => d !== null);
    const withClock = candidates.find(hasClockComponent);
    const dateTaken = withClock ?? candidates[0] ?? null;

    // Prefer the auto-unwrapped decimals; fall back to manually decoding
    // the raw degrees/minutes/seconds tuple some HEIC variants emit.
    const lat =
      typeof exif.latitude === "number"
        ? exif.latitude
        : toDecimalDegrees(exif.GPSLatitude, exif.GPSLatitudeRef);
    const lng =
      typeof exif.longitude === "number"
        ? exif.longitude
        : toDecimalDegrees(exif.GPSLongitude, exif.GPSLongitudeRef);

    return {
      dateTaken,
      dateTakenHasClock: dateTaken ? hasClockComponent(dateTaken) : false,
      lat: lat !== null && Number.isFinite(lat) ? lat : null,
      lng: lng !== null && Number.isFinite(lng) ? lng : null,
    };
  } catch (err) {
    // Never throw — a malformed EXIF block must not abort a sync run mid-batch
    // or reject an otherwise valid upload. But DO log it: a silent null here
    // hid a systematic reader failure that made every admin upload claim the
    // photo had no DateTimeOriginal.
    console.warn("[exif] unreadable", {
      path,
      message: (err as Error).message,
    });
    return EMPTY;
  }
}

/**
 * Coerce an EXIF date field into a Date. exifr usually returns a Date
 * instance, but if the underlying value can't be parsed (unusual EXIF
 * variants, broken pipelines) it can fall back to the raw string.
 */
function toDate(v: Date | string | undefined): Date | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null;
  const m = /^(\d{4}):(\d{2}):(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?/.exec(v);
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss] = m;
  const dt = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(hh ?? 0),
    Number(mm ?? 0),
    Number(ss ?? 0),
  );
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function hasClockComponent(d: Date): boolean {
  return d.getHours() !== 0 || d.getMinutes() !== 0 || d.getSeconds() !== 0;
}

/**
 * Converts EXIF GPS values (decimal number OR [deg, min, sec] tuple) plus a
 * direction reference ("N"/"S"/"E"/"W") into a signed decimal degree.
 */
function toDecimalDegrees(
  raw: number | number[] | undefined,
  ref: string | undefined,
): number | null {
  if (raw === undefined) return null;
  let dd: number;
  if (typeof raw === "number") {
    dd = raw;
  } else if (Array.isArray(raw) && raw.length >= 3) {
    dd = (raw[0] ?? 0) + (raw[1] ?? 0) / 60 + (raw[2] ?? 0) / 3600;
  } else {
    return null;
  }
  if (ref === "S" || ref === "W") dd = -dd;
  return Number.isFinite(dd) ? dd : null;
}
