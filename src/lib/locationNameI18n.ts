import { cache } from "react";
import { getLocale } from "next-intl/server";
import { readMapNoteOverrides } from "@/lib/mapNoteOverrides";

/**
 * English display names for locations.
 *
 * The same Czech text lives in the DB twice: as `location_maps.description`
 * (the map caption) and as `locations.display_name` — `scripts/sync.ts` writes
 * the manifest's `popis` into both, and both rows carry the same id (the
 * location's `číslo`). Only the caption had a translation layer, so a
 * fully-translated collection still showed Czech location names to English
 * visitors on /lokality, /mapa, /sbirka rows, /statistiky and the home widget.
 *
 * Rather than teach ten render sites about overrides, the query layer resolves
 * the name once: every DTO that carries a `displayName` runs it through the
 * resolver, so a new surface gets translated names for free.
 *
 * Falls back to the Czech text whenever no English override exists — same
 * stance as the "Czech only" fallback on map captions and find notes, minus
 * the badge (a location name is usually rendered inline, where a badge would
 * be noise).
 */

/** `(id, czechName) => name to display`. */
export type LocationNameResolver = (id: number, cs: string) => string;

const identity: LocationNameResolver = (_id, cs) => cs;

/**
 * Resolver for the CURRENT request's locale. Memoised per request via React's
 * `cache`, so the override file is read at most once per render even though
 * every query module asks for it.
 *
 * On `cs` it short-circuits to the identity function and never touches disk.
 * Outside a request context (sitemap generation, scripts) `getLocale()` throws
 * — Czech is the source language, so identity is the correct answer there too.
 */
export const locationNameResolver = cache(
  async (): Promise<LocationNameResolver> => {
    let locale: string;
    try {
      locale = await getLocale();
    } catch {
      return identity;
    }
    if (locale === "cs") return identity;
    const overrides = await readMapNoteOverrides();
    if (overrides.size === 0) return identity;
    return (id, cs) => overrides.get(id)?.en?.trim() || cs;
  },
);
