import type { MetadataRoute } from "next";
import { getIndexableFinds } from "@/lib/queries/finds";
import { listLocations } from "@/lib/queries/locations";
import { locationDetailHref } from "@/lib/format";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
  "https://ctyrlistkoteka.cz";

// Must be a literal for Next.js static analysis. Matches FIND_REVALIDATE
// in src/lib/constants.ts (24 hours) — the sitemap regenerates daily.
export const revalidate = 86400;

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

  const staticEntries: MetadataRoute.Sitemap = [
    {
      url: `${SITE_URL}/`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1.0,
    },
    {
      url: `${SITE_URL}/sbirka`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/lokality`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/mapa`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/statistiky`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.7,
    },
  ];

  const locationEntries: MetadataRoute.Sitemap = locations.map((l) => ({
    url: `${SITE_URL}${locationDetailHref(l.id)}`,
    lastModified: new Date(),
    changeFrequency: "weekly",
    priority: 0.6,
  }));

  const findEntries: MetadataRoute.Sitemap = finds.map((f) => ({
    url: `${SITE_URL}/sbirka/${f.id}`,
    lastModified: f.updatedAt,
    changeFrequency: "monthly",
    priority: 0.5,
  }));

  return [...staticEntries, ...locationEntries, ...findEntries];
}
