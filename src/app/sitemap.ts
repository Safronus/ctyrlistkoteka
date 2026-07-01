import type { MetadataRoute } from "next";
import { getIndexableFinds } from "@/lib/queries/finds";
import { listLocations } from "@/lib/queries/locations";
import { locationDetailHref } from "@/lib/format";
import { routing } from "@/i18n/routing";
import { siteBaseUrl } from "@/lib/seo";

const SITE_URL = siteBaseUrl();

// Must be a literal for Next.js static analysis. Matches FIND_REVALIDATE
// in src/lib/constants.ts (24 hours) — the sitemap regenerates daily.
export const revalidate = 86400;

/** Build URLs for all configured locales for a given path. The default
 *  locale is prefix-free (`/sbirka`), other locales get `/<locale>/...`
 *  per `localePrefix: 'as-needed'` in routing config. */
function localizedUrls(path: string): { url: string; alternates: Record<string, string> } {
  const cleanPath = path === "/" ? "" : path;
  const urls: Record<string, string> = {};
  for (const loc of routing.locales) {
    const prefix = loc === routing.defaultLocale ? "" : `/${loc}`;
    urls[loc] = `${SITE_URL}${prefix}${cleanPath || "/"}`;
  }
  return { url: urls[routing.defaultLocale]!, alternates: urls };
}

/** Wrap one path in a sitemap entry with hreflang alternates so search
 *  engines see CZ/EN as the same page in two languages. The Czech URL
 *  is canonical (default locale, no prefix). */
function entry(
  path: string,
  lastModified: Date | string,
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"],
  priority: number,
): MetadataRoute.Sitemap[number] {
  const { url, alternates } = localizedUrls(path);
  return {
    url,
    lastModified,
    changeFrequency,
    priority,
    alternates: { languages: alternates },
  };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Locations: include the same set the public list shows. Anonymized
  // locations are filtered out — their detail page renders only a stub
  // with `noindex`, so listing them in the sitemap would just waste
  // crawl budget. Former ("Zaniklá") locations stay indexable since
  // the detail page itself has full content for them.
  const [finds, locations] = await Promise.all([
    getIndexableFinds(),
    listLocations({ showAnonymized: false, showGone: true }),
  ]);

  const now = new Date();
  const staticEntries: MetadataRoute.Sitemap = [
    entry("/", now, "weekly", 1.0),
    entry("/sbirka", now, "daily", 0.9),
    entry("/lokality", now, "weekly", 0.8),
    entry("/mapa", now, "daily", 0.8),
    entry("/statistiky", now, "daily", 0.7),
  ];

  const locationEntries: MetadataRoute.Sitemap = locations.map((l) =>
    entry(locationDetailHref(l.id), now, "weekly", 0.6),
  );

  const findEntries: MetadataRoute.Sitemap = finds.map((f) =>
    entry(`/sbirka/${f.id}`, f.updatedAt, "monthly", 0.5),
  );

  return [...staticEntries, ...locationEntries, ...findEntries];
}
