/**
 * Best-effort decomposition of a LOCATION_CODE. Real-world codes are far
 * more variable than the reference grammar suggests — classic
 * `{CADASTRAL}_{TYPE}{NNN}[subpart]` is just one shape. This helper never
 * fails; it returns whatever it can extract and leaves the rest null so
 * the DB can still store the row. Downstream UI that wants structure
 * should be tolerant of nulls.
 *
 * Observed variants we handle:
 *   RATIBOŘ_POLE001f          → cadastral=RATIBOŘ  type=POLE     num=1 sub=f
 *   ZLÍN_ČEPKOV001            → cadastral=ZLÍN     type=ČEPKOV   num=1
 *   HOŠŤÁLKOVÁ001             → cadastral=HOŠŤÁLKOVÁ type=null   num=1
 *   RATIBOŘ_DOMA-JALOVEC      → cadastral=RATIBOŘ  type=DOMA-JALOVEC num=null
 *   ZLÍN_JSVAHY-SNP000        → cadastral=ZLÍN     type=JSVAHY-SNP num=0
 *   HLUBOKÁ NAD VLTAVOU_GC001 → spaces inside cadastral
 *   ZLÍN_JSVAHY-UTB-U5-Z001   → type=JSVAHY-UTB-U5-Z (multiple dashes)
 *   BIELSKO-BIALA002          → cadastral=BIELSKO-BIALA (no underscore)
 *   ZLíN_JSVAHY-UTB-U5-001    → inconsistent case — preserved verbatim
 */

export interface LocationCodeParts {
  cadastralArea: string;
  locationType: string | null;
  number: number | null;
  subpart: string | null;
}

/**
 * Splits a location code into components. Guarantees `cadastralArea` is
 * non-empty (falls back to the whole code when nothing else matches).
 */
export function splitLocationCode(code: string): LocationCodeParts {
  const trimmed = code.trim();
  if (!trimmed) {
    return {
      cadastralArea: code,
      locationType: null,
      number: null,
      subpart: null,
    };
  }

  // Shape 1: CADASTRAL_TYPE###[a-z]?
  // Non-greedy cadastral so the first underscore is treated as separator.
  // `.+?` also matches spaces and diacritics.
  const classic = /^([^_]+)_(.+?)(\d{3})([a-z]?)$/.exec(trimmed);
  if (classic) {
    const [, cadastral, rawType, nnn, sub] = classic;
    return {
      cadastralArea: cadastral!,
      locationType: trimTypeTail(rawType!),
      number: Number(nnn),
      subpart: sub ? sub : null,
    };
  }

  // Shape 2: CADASTRAL### (no type separator, still has 3-digit suffix).
  // Catches cases where the code has a trailing underscore but no type
  // segment between it and the digits — e.g. `NOVÝSMOKOVEC_001`
  // (location's filename pattern lacks the location-type slot). The
  // greedy cadastral capture would otherwise keep the trailing `_`,
  // turning two locations in the same town into separate city
  // buckets ("NOVÝSMOKOVEC" vs "NOVÝSMOKOVEC_"). Strip the same way
  // trimTypeTail handles the type segment.
  const simple = /^(.+?)(\d{3})([a-z]?)$/.exec(trimmed);
  if (simple) {
    const [, cadastral, nnn, sub] = simple;
    return {
      cadastralArea: stripCadastralTail(cadastral!),
      locationType: null,
      number: Number(nnn),
      subpart: sub ? sub : null,
    };
  }

  // Shape 3: CADASTRAL_TYPE with no number (e.g. RATIBOŘ_DOMA-JALOVEC).
  const idx = trimmed.indexOf("_");
  if (idx !== -1 && idx < trimmed.length - 1) {
    return {
      cadastralArea: trimmed.slice(0, idx),
      locationType: trimTypeTail(trimmed.slice(idx + 1)),
      number: null,
      subpart: null,
    };
  }

  // Shape 4: anything else — keep the whole string as cadastral.
  // Apply the same trailing-separator strip as Shape 2 so a freeform
  // code like `FOO_` doesn't leak the underscore into the dropdown.
  return {
    cadastralArea: stripCadastralTail(trimmed),
    locationType: null,
    number: null,
    subpart: null,
  };
}

/**
 * ASCII-safe transliteration of the location code. Used to populate
 * `code_transliterated` — a UNIQUE column retained from the older
 * on-disk convention. Now primarily useful for URL slugs and search.
 */
export function toAsciiCode(code: string): string {
  return code
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .replace(/\s+/g, "_")
    .replace(/[^\x20-\x7E]/g, "_"); // any remaining non-ASCII → _
}

/**
 * True when a location is gone / no-longer-existing. Since the v1→v2 maps
 * migration this is solely the manifest's `zrusena` → `locations.is_cancelled`.
 * The old v1 `NEEXISTUJE-` code prefix is retired: sync upserts by číslo, so a
 * v2 re-import rewrote those codes clean and set `is_cancelled=true`, leaving
 * no prefix behind. The `code` param is kept for call-site stability (every
 * caller already has both to hand); the prefix is no longer consulted.
 */
export function isLocationGone(
  code: string | null | undefined,
  isCancelled: boolean | null | undefined,
): boolean {
  // `code` is intentionally unused — kept only so the ~10 call sites that
  // already pass (code, isCancelled) don't need touching. Gone-ness is
  // purely the v2 is_cancelled flag now.
  return isCancelled === true;
}

/** Canonical "city" value derived from a cadastralArea string. v2 cadastral
 *  areas are the plain city (manifest `mesto`) — no marker prefix — so this
 *  is now just a coerce-to-string. Empty input returns "" so callers can use
 *  `|| undefined` to drop the filter entirely. */
export function cityFromCadastralArea(
  cadastral: string | null | undefined,
): string {
  return typeof cadastral === "string" ? cadastral : "";
}

function trimTypeTail(t: string): string | null {
  // Strip trailing separator before the 3-digit block ("FOO-" → "FOO").
  const cleaned = stripCadastralTail(t);
  return cleaned ? cleaned : null;
}

/** Strip trailing `_` / `-` from a cadastral capture. Used when the
 *  code has the form `CADASTRAL_###` with no type segment between
 *  the underscore and the digits — the greedy capture would
 *  otherwise keep the underscore. Empty result is impossible here
 *  because Shapes 2/4 always pass a non-empty captured string in. */
function stripCadastralTail(c: string): string {
  // Manual trim rather than `/[-_]+$/` — the anchored `+` is O(n²) on
  // pathological input (S8786); a reverse scan stays linear.
  let end = c.length;
  while (end > 0 && (c[end - 1] === "-" || c[end - 1] === "_")) end--;
  return c.slice(0, end);
}
