/**
 * Module-density vocabulary, split out of `qr.ts` so the admin FORMS can
 * import it. `qr.ts` reads the brand PNGs off disk at module load, which
 * makes it server-only; these two exports are pure and both forms need
 * them to warn about the centre-image/density conflict before rendering.
 */

/**
 * How densely the payload is packed. This is purely the QR error-
 * correction level under a friendlier name, because that is the only
 * meaningful lever on module count for a URL this short:
 *
 *   dense   = H (30 % redundancy) → 37×37 modules
 *   medium  = Q (25 %)            → 33×33
 *   compact = M (15 %)            → 29×29
 *
 * Fewer modules at the same printed size means physically BIGGER modules,
 * which scan from further away and survive worse printing. The catch: the
 * centre image punches a hole through real data modules, and only the
 * spare redundancy makes that survivable — hence `centerFitsDensity`.
 */
export type QrDensity = "dense" | "medium" | "compact";

export const DENSITY_ECC: Record<QrDensity, "H" | "Q" | "M"> = {
  dense: "H",
  medium: "Q",
  compact: "M",
};

/** Whether a centre image is safe at this density. At M the 15 % spare
 *  capacity is roughly what a `md` centre hole already eats, leaving no
 *  margin for print noise — so a centre is only offered up to Q, and only
 *  in the smaller size there. */
export function centerFitsDensity(
  density: QrDensity,
  centerScale: "sm" | "md",
): boolean {
  if (density === "dense") return true;
  if (density === "medium") return centerScale === "sm";
  return false;
}
