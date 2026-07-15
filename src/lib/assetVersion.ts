import { FIND_PHOTO_ASSET_VERSION } from "./constants";

/**
 * Appends the find-photo cache-busting version to a generated web/thumb/crop
 * URL. See {@link FIND_PHOTO_ASSET_VERSION} for the why (in-place regen +
 * Nginx `immutable`).
 *
 * Pass FIND-PHOTO URLs only (`/generated/web`, `/generated/thumb`) — NOT
 * location maps, which aren't regenerated and keep stable, indefinitely
 * cacheable URLs. No-ops on empty / `data:` / already-parameterized URLs, so
 * it is safe to wrap a value unconditionally.
 */
export function versionedPhotoUrl(url: string): string {
  if (!url || url.startsWith("data:") || url.includes("?")) return url;
  return `${url}?v=${FIND_PHOTO_ASSET_VERSION}`;
}
