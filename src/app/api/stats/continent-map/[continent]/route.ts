import { NextResponse, type NextRequest } from "next/server";
import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { isContinentKey, type ContinentKey } from "@/lib/continents";
import { continentMapEtag, renderContinentMapSvg } from "@/lib/continentMap";
import { getStatsGeo } from "@/lib/queries/stats";
import { localizedCountryName } from "@/lib/world-countries";

/**
 * One continent map for the /statistiky geo tabs, as an SVG document. The
 * tab fetches it on first click (see GeoMapToggle) so the 50m geometry never
 * weighs down the page HTML.
 *
 * Public on purpose — it's the same aggregate the page already shows, and
 * the input is a closed set (6 continents × 2 locales), so there is nothing
 * to enumerate or abuse. No HTTP max-age: counts must be fresh the moment a
 * sync finishes (getStatsGeo is the tagged data cache the sync revalidates);
 * the ETag turns a repeat load into a 304 instead.
 */
export const dynamic = "force-dynamic";

const ARIA_KEY = {
  europe: "geoMapEuropeAria",
  asia: "geoMapAsiaAria",
  africa: "geoMapAfricaAria",
  northAmerica: "geoMapNorthAmericaAria",
  southAmerica: "geoMapSouthAmericaAria",
  oceania: "geoMapOceaniaAria",
} as const satisfies Record<ContinentKey, string>;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ continent: string }> },
) {
  const { continent } = await params;
  if (!isContinentKey(continent)) {
    return new NextResponse("Not found", { status: 404 });
  }
  const requested = req.nextUrl.searchParams.get("locale") ?? "";
  const locale = (routing.locales as readonly string[]).includes(requested)
    ? requested
    : routing.defaultLocale;

  const [t, { byCountry }] = await Promise.all([
    getTranslations({ locale, namespace: "Statistiky" }),
    getStatsGeo(),
  ]);
  const svg = renderContinentMapSvg({
    continent,
    byCountry,
    label: (id, name) => localizedCountryName(name, locale, id),
    tooltip: (label, count) => `${label}: ${count} ${t("labelFinds", { count })}`,
    ariaLabel: t(ARIA_KEY[continent]),
  });

  const etag = continentMapEtag(svg);
  const headers = {
    "content-type": "image/svg+xml; charset=utf-8",
    "cache-control": "public, max-age=0, must-revalidate",
    "x-content-type-options": "nosniff",
    etag,
  };
  if (req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers });
  }
  return new NextResponse(svg, { headers });
}
