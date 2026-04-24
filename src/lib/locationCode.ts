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
 *   NEEXISTUJE-VSETÍN000      → cadastral=NEEXISTUJE-VSETÍN (prefix kept)
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
  const classic = /^(.+?)_(.+?)(\d{3})([a-z]?)$/.exec(trimmed);
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
  const simple = /^(.+?)(\d{3})([a-z]?)$/.exec(trimmed);
  if (simple) {
    const [, cadastral, nnn, sub] = simple;
    return {
      cadastralArea: cadastral!,
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
  return {
    cadastralArea: trimmed,
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

function trimTypeTail(t: string): string | null {
  // Strip trailing separator before the 3-digit block ("FOO-" → "FOO").
  const cleaned = t.replace(/[-_]+$/, "");
  return cleaned ? cleaned : null;
}
