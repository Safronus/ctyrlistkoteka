/**
 * Public pages a generated QR can point at. Shared by the admin QR
 * generator (dropdown + preview URL) and the /go/<token> redirect.
 */
export const QR_TARGETS = [
  { key: "home", path: "/", label: "Domů" },
  { key: "sbirka", path: "/sbirka", label: "Sbírka" },
  { key: "lokality", path: "/lokality", label: "Lokality" },
  { key: "mapa", path: "/mapa", label: "Mapa" },
  { key: "statistiky", path: "/statistiky", label: "Statistiky" },
] as const;

export type QrTargetKey = (typeof QR_TARGETS)[number]["key"];

export const QR_TARGET_KEYS: readonly string[] = QR_TARGETS.map((t) => t.key);

/** Locale-aware path for a target. cs has no prefix (localePrefix
 *  'as-needed'); en gets the `/en` prefix. */
export function qrTargetPath(target: string, locale: string): string {
  const t = QR_TARGETS.find((x) => x.key === target) ?? QR_TARGETS[0];
  const base = t.path;
  if (locale === "en") return base === "/" ? "/en" : `/en${base}`;
  return base;
}

export function qrTargetLabel(target: string): string {
  return QR_TARGETS.find((x) => x.key === target)?.label ?? target;
}

/** Friendly absolute URL for the chosen target — used for the preview's
 *  encoded link (before a token exists) and the optional caption text. */
export function qrTargetUrl(
  target: string,
  locale: string,
  siteUrl: string,
): string {
  return `${siteUrl.replace(/\/$/, "")}${qrTargetPath(target, locale)}`;
}
