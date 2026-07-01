/**
 * IndexNow — instant URL submission to Bing, Seznam.cz and Yandex (Google
 * doesn't participate). We ping it from the sync script whenever new finds
 * land, so they get crawled in hours instead of waiting for the next
 * sitemap poll. The key is PUBLIC by design (it's exposed in the key file
 * and in every request) — committing it is fine, it's not a secret.
 *
 * The key is verified by hosting its value at `keyLocation`; we serve it
 * from a tiny route (`/indexnow-key`) rather than the conventional
 * `/<key>.txt` so it doesn't collide with the i18n middleware's rewrites
 * (a dotted root path would be treated as a locale route). Passing
 * `keyLocation` explicitly is allowed by the IndexNow spec.
 *
 * Self-contained on purpose (no `@/` imports): the sync script imports
 * this via a relative path under tsx, so it must not pull in the alias-
 * using SEO helpers.
 */

export const INDEXNOW_KEY = "ff06ccebf640b9bcf948e327ebfeefbf";

const ENDPOINT = "https://api.indexnow.org/indexnow";
/** IndexNow accepts at most 10 000 URLs per request. */
const MAX_URLS = 10_000;

/** Public site origin (https-forced for the real domain), mirroring
 *  siteBaseUrl() in src/lib/seo.ts without the routing dependency. */
function siteOrigin(): URL {
  const raw = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  try {
    const u = new URL(raw);
    const isLocal =
      u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (!isLocal && u.protocol === "http:") u.protocol = "https:";
    return new URL(u.origin);
  } catch {
    return new URL("https://ctyrlistkoteka.cz");
  }
}

/** Absolute find-detail URL for IndexNow submission. */
export function findUrl(id: number): string {
  return `${siteOrigin().origin}/sbirka/${id}`;
}

export interface IndexNowResult {
  ok: boolean;
  status?: number;
  submitted: number;
  skipped?: string;
}

/**
 * Submit URLs to IndexNow. Best-effort: never throws, returns a small
 * result for logging. Skips localhost hosts (IndexNow can't fetch a
 * localhost keyLocation) so local/dev syncs are no-ops.
 */
export async function pingIndexNow(
  urls: readonly string[],
): Promise<IndexNowResult> {
  if (urls.length === 0) return { ok: true, submitted: 0, skipped: "empty" };
  const base = siteOrigin();
  if (base.hostname === "localhost" || base.hostname === "127.0.0.1") {
    return { ok: true, submitted: 0, skipped: "localhost" };
  }
  const urlList = [...new Set(urls)].slice(0, MAX_URLS);
  const body = {
    host: base.hostname,
    key: INDEXNOW_KEY,
    keyLocation: `${base.origin}/indexnow-key`,
    urlList,
  };
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status, submitted: urlList.length };
  } catch {
    return { ok: false, submitted: 0, skipped: "fetch-failed" };
  }
}
