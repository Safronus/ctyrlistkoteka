import type { MetadataRoute } from "next";
import { getIndexableFinds } from "@/lib/queries/finds";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
  "https://ctyrlistkoteka.cz";

// Must be a literal for Next.js static analysis. Matches FIND_REVALIDATE
// in src/lib/constants.ts (24 hours) — the sitemap regenerates daily.
export const revalidate = 86400;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const finds = await getIndexableFinds();

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

  const findEntries: MetadataRoute.Sitemap = finds.map((f) => ({
    url: `${SITE_URL}/sbirka/${f.id}`,
    lastModified: f.updatedAt,
    changeFrequency: "monthly",
    priority: 0.5,
  }));

  return [...staticEntries, ...findEntries];
}
