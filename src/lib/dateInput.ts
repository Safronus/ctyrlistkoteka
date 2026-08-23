/**
 * The text side of a typed date field: ISO ⇄ what a reader writes.
 *
 * Lives here rather than in the component because it is the part that can
 * be wrong without anything looking broken — a format that disagrees with
 * its own placeholder, or a parser that turns 31 February into March.
 */

/** ISO → what the reader types: `14. 6. 2021` in Czech, `2021-06-14` in EN. */
export function isoToDisplay(iso: string, locale: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  if (locale === "en") return iso;
  // Czech writes "14. 6. 2021" — no leading zeros, space after each dot,
  // which is what the placeholder promises and what the rest of the site
  // shows. Built by hand rather than with Intl on purpose: this value is
  // server-rendered, and ICU differences between Node and the browser
  // would turn a formatting detail into a hydration mismatch.
  return `${Number(iso.slice(8))}. ${Number(iso.slice(5, 7))}. ${iso.slice(0, 4)}`;
}

/**
 * What the reader typed → ISO, "" for an emptied field, or null when it is
 * not a date yet.
 *
 * Deliberately forgiving about separators and leading zeros — `1.3.2019`,
 * `01. 03. 2019` and `2019-03-01` all mean the same day — because the
 * whole point of this field is that a typed date is not judged until it
 * is finished.
 */
export function parseTypedDate(text: string): string | null {
  const s = text.trim();
  if (s === "") return "";
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  const cs = /^(\d{1,2})\s*[.\/-]\s*(\d{1,2})\s*[.\/-]\s*(\d{4})$/.exec(s);
  const [y, m, d] = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : cs
      ? [Number(cs[3]), Number(cs[2]), Number(cs[1])]
      : [0, 0, 0];
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
  // Reject a day the month does not have (31 February) rather than let
  // Date roll it over into March.
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCMonth() !== m - 1) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** The hint under the reader's cursor — must match what `isoToDisplay`
 *  produces, or the field contradicts itself. */
export function dateInputPlaceholder(locale: string): string {
  return locale === "en" ? "yyyy-mm-dd" : "d. m. rrrr";
}

/** Keeps a date inside the collection's own span. */
export function clampDate(
  iso: string,
  min: string | null,
  max: string | null,
): string {
  if (!iso) return iso;
  if (min && iso < min) return min;
  if (max && iso > max) return max;
  return iso;
}
