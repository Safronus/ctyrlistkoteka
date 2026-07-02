import { siteBaseUrl } from "@/lib/seo";

/**
 * schema.org JSON-LD builders. All URLs are absolute (search engines
 * require it for structured data). Consumers wrap the returned objects in
 * the <JsonLd> component. Nothing here touches anonymized data — callers
 * only build schema for public (non-anonymized) entities.
 */

type Schema = Record<string, unknown>;

const CONTEXT = "https://schema.org";

/** WebSite + SearchAction (home) → enables Google's sitelinks search box,
 *  wired to the /sbirka `q` search. */
export function websiteSchema(name: string, locale: string): Schema {
  const base = siteBaseUrl();
  return {
    "@context": CONTEXT,
    "@type": "WebSite",
    name,
    url: base,
    inLanguage: locale === "en" ? "en" : "cs",
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${base}/sbirka?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

/** BreadcrumbList from a list of {name, path} crumbs (path is site-root
 *  relative, e.g. "/sbirka/20000"). */
export function breadcrumbSchema(
  items: ReadonlyArray<{ name: string; path: string }>,
): Schema {
  const base = siteBaseUrl();
  return {
    "@context": CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: `${base}${it.path === "/" ? "" : it.path}` || base,
    })),
  };
}

/** A find as an ImageObject (photo of a clover at a place + date). Callers
 *  pass already-public fields; geo is included only when coordinates are
 *  present (i.e. non-anonymized finds with GPS). */
export function findImageSchema(args: {
  name: string;
  description: string;
  contentUrl: string | null;
  thumbnailUrl: string | null;
  foundAt: string | null;
  locationName: string | null;
  coordinates: { lat: number; lng: number } | null;
}): Schema {
  const base = siteBaseUrl();
  const abs = (u: string) => (u.startsWith("http") ? u : `${base}${u}`);
  const schema: Schema = {
    "@context": CONTEXT,
    "@type": "ImageObject",
    name: args.name,
    description: args.description,
  };
  if (args.contentUrl) schema.contentUrl = abs(args.contentUrl);
  if (args.thumbnailUrl) schema.thumbnailUrl = abs(args.thumbnailUrl);
  if (args.foundAt) schema.dateCreated = args.foundAt;
  if (args.locationName) {
    const place: Schema = { "@type": "Place", name: args.locationName };
    if (args.coordinates) {
      place.geo = {
        "@type": "GeoCoordinates",
        latitude: args.coordinates.lat,
        longitude: args.coordinates.lng,
      };
    }
    schema.contentLocation = place;
  }
  return schema;
}

/** A location as a Place with geo coordinates (non-anonymized only). */
export function placeSchema(args: {
  name: string;
  description: string;
  coordinates: { lat: number; lng: number } | null;
}): Schema {
  const schema: Schema = {
    "@context": CONTEXT,
    "@type": "Place",
    name: args.name,
    description: args.description,
  };
  if (args.coordinates) {
    schema.geo = {
      "@type": "GeoCoordinates",
      latitude: args.coordinates.lat,
      longitude: args.coordinates.lng,
    };
  }
  return schema;
}
