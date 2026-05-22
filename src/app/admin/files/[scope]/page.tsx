import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  FileText,
  Image as ImageIcon,
  Search,
} from "lucide-react";
import path from "node:path";
import {
  getFindIdsWithExifProblems,
  getFindIdsWithoutGps,
} from "@/lib/admin/checks";
import { ensureAdminAuth } from "@/lib/admin/guard";
import { readMapAnonFlags } from "@/lib/admin/mapAnon";
import { getRealPhotoMapKeys } from "@/lib/locationPhotos";
import { checkSyncNeeded, type SyncScope } from "@/lib/admin/syncNeeded";
import {
  analyzeIdRange,
  extractFindId,
  extractMapId,
  getScope,
  listScope,
  listScopeFindIds,
  type MissingRange,
  type RangeAnalysis,
  type ScopeSlug,
} from "@/lib/admin/scopes";
import { FilesListClient } from "../_shared/files-list-client";
import { SyncNeededBanner } from "../_shared/sync-needed-banner";
import { deleteCropsBulk } from "../crops/delete-action";
import { CropsUploadForm } from "../crops/upload-form";
import { deleteDonationPhotosBulk } from "../donation-photos/delete-action";
import { DonationPhotosUploadForm } from "../donation-photos/upload-form";
import { deleteFindsBulk } from "../finds/delete-action";
import { FindsUploadForm } from "../finds/upload-form";
import { deleteLocationPhotosBulk } from "../location-photos/delete-action";
import { LocationPhotosUploadForm } from "../location-photos/upload-form";
import { deleteMapsBulk } from "../maps/delete-action";
import { markMapsNonexistentBulk } from "../maps/rename-action";
import { MapsUploadForm } from "../maps/upload-form";

/** Allowed `?size=` values. Capped at 500 because each entry incurs
 *  one `fs.stat` call in listScope; on finds (17k+ files) a larger
 *  page would noticeably slow the listing render. For maps (~130
 *  entries) any value at or above 200 effectively shows everything. */
const PAGE_SIZE_OPTIONS = [50, 100, 200, 500] as const;
const DEFAULT_PAGE_SIZE = 100;
/** Maps fit in one page at 500 (~130 entries today, growing slowly).
 *  Default to that for the scope so the user doesn't paginate over
 *  what's effectively a flat config list. Other scopes keep the
 *  conservative 100. */
const SCOPE_DEFAULT_PAGE_SIZE: Record<string, number> = {
  maps: 500,
};

function pickPageSize(v: string | undefined, scopeSlug: string): number {
  const scopeDefault =
    SCOPE_DEFAULT_PAGE_SIZE[scopeSlug] ?? DEFAULT_PAGE_SIZE;
  if (!v) return scopeDefault;
  const n = Number.parseInt(v, 10);
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(n)
    ? n
    : scopeDefault;
}

interface PageProps {
  params: Promise<{ scope: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function pickString(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

function pickInt(v: string | undefined, fallback: number): number {
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function isImageName(name: string): boolean {
  return /\.(jpe?g|png|webp|heic|heif|gif)$/i.test(name);
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Formats every missing-ID range as a human-readable list. Singletons
 *  render as a bare number, contiguous gaps as `start–end`, all padded
 *  to the width of `max` so columns line up. Joined by ", ". The whole
 *  list goes through — caller can decide to wrap it in <details> if
 *  there are many ranges. */
function formatMissingRanges(ranges: readonly MissingRange[], max: number): string {
  if (ranges.length === 0) return "";
  const width = String(max).length;
  return ranges
    .map((r) =>
      r.start === r.end
        ? String(r.start).padStart(width, "0")
        : `${String(r.start).padStart(width, "0")}–${String(r.end).padStart(width, "0")}`,
    )
    .join(", ");
}

export default async function AdminScopeListPage({
  params,
  searchParams,
}: PageProps) {
  await ensureAdminAuth();
  const { scope: scopeSlug } = await params;
  const sp = await searchParams;
  const scope = getScope(scopeSlug);
  if (!scope) notFound();

  const query = pickString(sp.q) ?? "";
  const page = pickInt(pickString(sp.page), 1);
  const pageSize = pickPageSize(pickString(sp.size), scope.slug);
  const defaultPageSize =
    SCOPE_DEFAULT_PAGE_SIZE[scope.slug] ?? DEFAULT_PAGE_SIZE;
  const duplicatesOnly = pickString(sp.dups) === "1";
  const idDuplicatesOnly = pickString(sp.id_dups) === "1";
  const uncoveredOnly = pickString(sp.uncovered) === "1";
  // EXIF-broken filter: limits the listing to files whose leading
  // find ID is in the set of finds missing `foundAt`. Active only on
  // finds + crops scopes (maps and meta don't share that ID). The
  // bad-id set is also fetched unconditionally (when applicable) so
  // every row can render an indicator badge — see exifProblemIds
  // prop on FilesListClient below.
  const exifBrokenOnly =
    (scope.slug === "finds" || scope.slug === "crops") &&
    pickString(sp.exif_broken) === "1";
  // GPS-broken filter: same shape as exif_broken but driven by
  // checkFindsWithoutGps (excludes finds explicitly flagged NO_GPS).
  const gpsBrokenOnly =
    (scope.slug === "finds" || scope.slug === "crops") &&
    pickString(sp.gps_broken) === "1";
  // Maps-only filters: surface zaniklé / anonymizované entries on
  // demand. Both default off so the listing matches the rest of the
  // admin (no cluttered initial view).
  const onlyNonexistent =
    scope.slug === "maps" && pickString(sp.nonexistent) === "1";
  const onlyAnonymized =
    scope.slug === "maps" && pickString(sp.anonymized) === "1";
  const offset = (page - 1) * pageSize;

  // Cross-scope coverage: finds ↔ crops share only the leading find
  // ID, NOT the rest of the filename (state token, anonymisation
  // flag, note marker can drift when the user re-watermarks or
  // changes status). Match by ID, not by full name.
  //
  // `counterpart` carries the matching scope reference for the
  // header link ("→ Výřezy" on /finds, "→ Originály" on /crops).
  // The two are paired by find ID so cross-navigation is the natural
  // workflow when fixing coverage gaps.
  let counterpartIds: Set<number> | undefined;
  let counterpartLabel: string | undefined;
  let counterpart:
    | { slug: ScopeSlug; label: string; missingLabel: string }
    | undefined;
  if (scope.slug === "finds") {
    const cropsScope = getScope("crops");
    if (cropsScope) {
      counterpartIds = await listScopeFindIds(cropsScope);
      counterpartLabel = "bez crops";
      counterpart = {
        slug: cropsScope.slug,
        label: cropsScope.label,
        missingLabel: "Přejít na Výřezy",
      };
    }
  } else if (scope.slug === "crops") {
    const findsScope = getScope("finds");
    if (findsScope) {
      counterpartIds = await listScopeFindIds(findsScope);
      counterpartLabel = "bez originálu";
      counterpart = {
        slug: findsScope.slug,
        label: findsScope.label,
        missingLabel: "Přejít na Originály",
      };
    }
  }

  // ID-range analysis: finds + crops use the leading find ID, maps
  // use the trailing 5-digit map ID. Other scopes have no range
  // concept, so the banner stays hidden.
  let range: RangeAnalysis | null = null;
  let rangeLabel: string | null = null;
  let rangePad = 1;
  let idExtractor: ((filename: string) => number | null) | null = null;
  if (scope.slug === "finds" || scope.slug === "crops") {
    idExtractor = extractFindId;
    range = await analyzeIdRange(scope, idExtractor);
    rangeLabel = "Find ID";
  } else if (scope.slug === "maps") {
    idExtractor = extractMapId;
    range = await analyzeIdRange(scope, idExtractor);
    rangeLabel = "Map ID";
    rangePad = 5;
  }
  // Duplicate-ID filter: when active, listScope keeps only the files
  // whose extracted ID appears more than once in the dir. That's
  // exactly the case where a 4423-vs-4422 mismatch comes from — two
  // files (e.g. `4350+seg+seg…jpg` and `4350.jpg`) pointing at the
  // same find. Active only when there ARE duplicates; otherwise the
  // filter chip just disappears so the user can't toggle a no-op.
  const duplicateIdSet =
    idDuplicatesOnly && range && range.duplicateIds.length > 0
      ? new Set(range.duplicateIds)
      : null;

  // Maps anonymization scan: only run on the maps scope, costs one
  // 64KB read per file. Cached in-memory by mtime so the next render
  // is free. Scoped before listScope so it can drive the keepName
  // filter when "Jen anonymizované" is on.
  let anonymizedNamesNFC: Set<string> | undefined;
  if (scope.slug === "maps") {
    anonymizedNamesNFC = await readMapAnonFlags();
  }

  // EXIF-bad + GPS-bad find IDs — both DB queries, cheap (single
  // index scan + a few dozen rows in the worst case). Fetched on
  // finds + crops so the row indicators + optional filters share
  // one source of truth.
  let exifProblemIds: Set<number> | undefined;
  let gpsProblemIds: Set<number> | undefined;
  if (scope.slug === "finds" || scope.slug === "crops") {
    [exifProblemIds, gpsProblemIds] = await Promise.all([
      getFindIdsWithExifProblems(),
      getFindIdsWithoutGps(),
    ]);
  }

  // Sync-needed banner. Computed for finds/crops/maps because
  // sync.ts reads those dirs; meta is checked on the file detail
  // page (JSON náhled) instead of here. donation/location photos
  // skip — they live in generated/ and bypass sync entirely.
  const SYNC_BANNER_CONFIG: Record<
    string,
    { preset: SyncScope; label: string }
  > = {
    finds: { preset: "finds", label: "Originály nálezů" },
    crops: { preset: "finds", label: "Výřezy nálezů" },
    maps: { preset: "maps", label: "Lokační mapy" },
  };
  const syncBannerCfg = SYNC_BANNER_CONFIG[scope.slug];
  const syncBannerProps = syncBannerCfg
    ? {
        result: await checkSyncNeeded([syncBannerCfg.preset]),
        preset: syncBannerCfg.preset,
        label: syncBannerCfg.label,
      }
    : null;

  const keepName: ((name: string) => boolean) | undefined =
    onlyNonexistent ||
    onlyAnonymized ||
    duplicateIdSet ||
    exifBrokenOnly ||
    gpsBrokenOnly
      ? (name) => {
          if (onlyNonexistent && !name.startsWith("NEEXISTUJE-")) return false;
          if (
            onlyAnonymized &&
            !(anonymizedNamesNFC?.has(name) ?? false)
          ) {
            return false;
          }
          if (duplicateIdSet) {
            const id = idExtractor?.(name);
            if (id === null || id === undefined || !duplicateIdSet.has(id)) {
              return false;
            }
          }
          if (exifBrokenOnly && exifProblemIds) {
            const id = idExtractor?.(name);
            if (id === null || id === undefined || !exifProblemIds.has(id)) {
              return false;
            }
          }
          if (gpsBrokenOnly && gpsProblemIds) {
            const id = idExtractor?.(name);
            if (id === null || id === undefined || !gpsProblemIds.has(id)) {
              return false;
            }
          }
          return true;
        }
      : undefined;

  const { total, entries } = await listScope(scope, {
    query: query || undefined,
    offset,
    limit: pageSize,
    duplicatesOnly,
    excludeFindIds: uncoveredOnly ? counterpartIds : undefined,
    keepName,
  });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Maps-only: which of the current page's entries already have a
  // real-life photo in generated/location-photos/. The set is keyed
  // by the raw entry name (no NFC by caller) so the client check is
  // a plain `.has(e.name)`. Built only for the maps scope — for
  // other scopes the prop stays undefined and the badge is skipped.
  let mapsWithRealPhoto: Set<string> | undefined;
  if (scope.slug === "maps") {
    const photoKeys = await getRealPhotoMapKeys();
    mapsWithRealPhoto = new Set();
    for (const e of entries) {
      const ext = path.extname(e.name);
      const key = e.name
        .slice(0, e.name.length - ext.length)
        .normalize("NFC")
        .toLowerCase();
      if (photoKeys.has(key)) mapsWithRealPhoto.add(e.name);
    }
  }

  // Global uncovered count for the summary line. Read this scope's
  // own ID set and count IDs missing from the counterpart.
  let uncoveredCount: number | undefined;
  if (counterpartIds) {
    const ownIds = await listScopeFindIds(scope);
    let n = 0;
    for (const id of ownIds) {
      if (!counterpartIds.has(id)) n += 1;
    }
    uncoveredCount = n;
  }

  const buildHref = (
    overrides: Partial<{
      q: string;
      page: number;
      size: number;
      dups: boolean;
      id_dups: boolean;
      uncovered: boolean;
      nonexistent: boolean;
      anonymized: boolean;
      exif_broken: boolean;
      gps_broken: boolean;
    }>,
  ) => {
    const merged = {
      q: query,
      page,
      size: pageSize,
      dups: duplicatesOnly,
      id_dups: idDuplicatesOnly,
      uncovered: uncoveredOnly,
      nonexistent: onlyNonexistent,
      anonymized: onlyAnonymized,
      exif_broken: exifBrokenOnly,
      gps_broken: gpsBrokenOnly,
      ...overrides,
    };
    const usp = new URLSearchParams();
    if (merged.q) usp.set("q", merged.q);
    if (merged.page > 1) usp.set("page", String(merged.page));
    if (merged.size !== defaultPageSize)
      usp.set("size", String(merged.size));
    if (merged.dups) usp.set("dups", "1");
    if (merged.id_dups) usp.set("id_dups", "1");
    if (merged.uncovered) usp.set("uncovered", "1");
    if (merged.nonexistent) usp.set("nonexistent", "1");
    if (merged.anonymized) usp.set("anonymized", "1");
    if (merged.exif_broken) usp.set("exif_broken", "1");
    if (merged.gps_broken) usp.set("gps_broken", "1");
    const qs = usp.toString();
    return qs ? `/admin/files/${scope.slug}?${qs}` : `/admin/files/${scope.slug}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link
          href="/admin/files"
          className="inline-flex items-center gap-1 hover:text-gray-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Soubory
        </Link>
        <span aria-hidden>/</span>
        <span className="text-gray-900">{scope.label}</span>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-gray-900">{scope.label}</h1>
          <p className="text-sm text-gray-500">
            {scope.description} •{" "}
            {total.toLocaleString("cs-CZ")}{" "}
            {total === 1 ? "položka" : total < 5 ? "položky" : "položek"}
            {query ? " v aktuálním filtru" : ""}
            {uncoveredCount !== undefined && uncoveredCount > 0 && (
              <>
                {" • "}
                <span className="text-amber-700">
                  {uncoveredCount.toLocaleString("cs-CZ")}{" "}
                  {counterpartLabel}
                </span>
              </>
            )}
          </p>
        </div>
        {counterpart && (
          <Link
            href={`/admin/files/${counterpart.slug}`}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800"
          >
            {counterpart.missingLabel}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        )}
      </header>

      {scope.slug === "finds" && <FindsUploadForm />}
      {scope.slug === "crops" && <CropsUploadForm />}
      {scope.slug === "maps" && <MapsUploadForm />}
      {scope.slug === "donation-photos" && <DonationPhotosUploadForm />}
      {scope.slug === "location-photos" && <LocationPhotosUploadForm />}

      {syncBannerProps && (
        <SyncNeededBanner
          result={syncBannerProps.result}
          preset={syncBannerProps.preset}
          label={syncBannerProps.label}
        />
      )}

      {(scope.slug === "donation-photos" ||
        scope.slug === "location-photos") && (
        <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-600">
          Reálné fotky se nečtou přes sync — cache se invaliduje
          automaticky při uploadu/mazání.
        </p>
      )}

      {range && rangeLabel && (
        <section
          className={`rounded-xl border px-4 py-3 text-xs ${
            range.missingCount > 0 ||
            range.duplicateIds.length > 0 ||
            range.filesWithoutId > 0
              ? "border-amber-200 bg-amber-50 text-amber-900"
              : "border-emerald-200 bg-emerald-50 text-emerald-900"
          }`}
        >
          <p className="font-medium">
            {rangeLabel}{" "}
            <code className="font-mono">
              {String(range.min).padStart(rangePad, "0")}
            </code>{" "}
            –{" "}
            <code className="font-mono">
              {String(range.max).padStart(rangePad, "0")}
            </code>{" "}
            · {range.uniqueIds.toLocaleString("cs-CZ")} unikátních ID
            {range.filesWithId !== range.uniqueIds &&
              ` v ${range.filesWithId.toLocaleString("cs-CZ")} souborech`}
            {range.missingCount === 0
              ? " · v intervalu nic nechybí"
              : ` · chybí ${range.missingCount.toLocaleString("cs-CZ")} ID v ${range.missingRanges.length.toLocaleString(
                  "cs-CZ",
                )} ${range.missingRanges.length === 1 ? "rozsahu" : "rozsazích"}`}
            {range.filesWithoutId > 0 &&
              ` · ${range.filesWithoutId.toLocaleString("cs-CZ")} souborů bez parsovatelného ID`}
          </p>
          {range.missingCount > 0 && (
            // Render every range — no truncation. The list scrolls if
            // the dir is pathologically gappy; in practice for ~17 k
            // finds it's a few hundred ranges at most. `max-h-72` +
            // overflow keeps it from dominating the page even then.
            <div className="mt-1 max-h-72 overflow-auto rounded-md bg-white/40 p-2">
              <p className="break-words font-mono text-[11px] leading-snug">
                {formatMissingRanges(range.missingRanges, range.max)}
              </p>
            </div>
          )}
          {range.duplicateIds.length > 0 && (
            // List the duplicate-ID values explicitly so the user can
            // see *which* IDs collide. A 4423-vs-4422 mismatch is one
            // ID listed here; a worse case shows the full list. The
            // filter chip below the search box jumps straight to those
            // files in the listing.
            <p className="mt-1 break-words font-mono text-[11px] leading-snug text-rose-800">
              <span className="font-semibold not-italic">
                Duplicitní ID ({range.duplicateIds.length}):
              </span>{" "}
              {range.duplicateIds
                .map((id) => String(id).padStart(rangePad, "0"))
                .join(", ")}
            </p>
          )}
        </section>
      )}

      <form
        action={`/admin/files/${scope.slug}`}
        method="get"
        className="flex items-center gap-2"
      >
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
            aria-hidden
          />
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Hledat v názvech…"
            className="block w-full rounded-md border border-gray-300 bg-white py-1.5 pl-9 pr-3 text-sm shadow-sm placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          />
        </div>
        {/* Carry the current page size + duplicates filter through a
            search submit so the user doesn't bounce back to defaults
            every time they refine the filter. */}
        {pageSize !== defaultPageSize && (
          <input type="hidden" name="size" value={String(pageSize)} />
        )}
        {duplicatesOnly && <input type="hidden" name="dups" value="1" />}
        {idDuplicatesOnly && (
          <input type="hidden" name="id_dups" value="1" />
        )}
        {uncoveredOnly && <input type="hidden" name="uncovered" value="1" />}
        {onlyNonexistent && (
          <input type="hidden" name="nonexistent" value="1" />
        )}
        {onlyAnonymized && (
          <input type="hidden" name="anonymized" value="1" />
        )}
        {exifBrokenOnly && (
          <input type="hidden" name="exif_broken" value="1" />
        )}
        {gpsBrokenOnly && (
          <input type="hidden" name="gps_broken" value="1" />
        )}
        <button
          type="submit"
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700"
        >
          Hledat
        </button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-gray-500">
        <div className="flex flex-wrap items-center gap-2">
          {duplicatesOnly ? (
            <Link
              href={buildHref({ dups: false, page: 1 })}
              className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 font-medium text-amber-900 hover:bg-amber-100"
            >
              <span aria-hidden>×</span>
              Zrušit filtr duplikátů názvů
            </Link>
          ) : (
            <Link
              href={buildHref({ dups: true, page: 1 })}
              className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-0.5 hover:bg-gray-50"
            >
              Filtr: jen duplikáty názvů (NFC)
            </Link>
          )}
          {/* Filtr "duplicitní ID" — různé názvy se stejným find ID
              (např. dlouhá vs zkrácená crop forma). Filter chip se
              zobrazí jen když takové duplicity v dir reálně jsou. */}
          {range && range.duplicateIds.length > 0 && (
            idDuplicatesOnly ? (
              <Link
                href={buildHref({ id_dups: false, page: 1 })}
                className="inline-flex items-center gap-1 rounded-md border border-rose-300 bg-rose-50 px-2 py-0.5 font-medium text-rose-900 hover:bg-rose-100"
              >
                <span aria-hidden>×</span>
                Zrušit filtr duplicitních ID
              </Link>
            ) : (
              <Link
                href={buildHref({ id_dups: true, page: 1 })}
                className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-white px-2 py-0.5 text-rose-700 hover:border-rose-300 hover:bg-rose-50"
                title="Zobrazit jen soubory, jejichž ID se v adresáři opakuje"
              >
                Filtr: jen duplicitní ID ({range.duplicateIds.length})
              </Link>
            )
          )}
          {counterpartLabel &&
            (uncoveredOnly ? (
              <Link
                href={buildHref({ uncovered: false, page: 1 })}
                className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 font-medium text-amber-900 hover:bg-amber-100"
              >
                <span aria-hidden>×</span>
                Zrušit filtr „{counterpartLabel}&ldquo;
              </Link>
            ) : (
              <Link
                href={buildHref({ uncovered: true, page: 1 })}
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-0.5 hover:bg-gray-50"
              >
                Filtr: jen „{counterpartLabel}&ldquo;
              </Link>
            ))}
          {(scope.slug === "finds" || scope.slug === "crops") &&
            exifProblemIds !== undefined &&
            exifProblemIds.size > 0 &&
            (exifBrokenOnly ? (
              <Link
                href={buildHref({ exif_broken: false, page: 1 })}
                className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 font-medium text-amber-900 hover:bg-amber-100"
              >
                <span aria-hidden>×</span>
                Zrušit „jen bez EXIF data&ldquo;
              </Link>
            ) : (
              <Link
                href={buildHref({ exif_broken: true, page: 1 })}
                className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-white px-2 py-0.5 text-amber-800 hover:border-amber-300 hover:bg-amber-50"
                title="Zobrazit jen soubory, jejichž find ID je v DB bez EXIF data"
              >
                Filtr: jen bez EXIF data ({exifProblemIds.size})
              </Link>
            ))}
          {(scope.slug === "finds" || scope.slug === "crops") &&
            gpsProblemIds !== undefined &&
            gpsProblemIds.size > 0 &&
            (gpsBrokenOnly ? (
              <Link
                href={buildHref({ gps_broken: false, page: 1 })}
                className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 font-medium text-amber-900 hover:bg-amber-100"
              >
                <span aria-hidden>×</span>
                Zrušit „jen bez EXIF GPS&ldquo;
              </Link>
            ) : (
              <Link
                href={buildHref({ gps_broken: true, page: 1 })}
                className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-white px-2 py-0.5 text-amber-800 hover:border-amber-300 hover:bg-amber-50"
                title="Zobrazit jen soubory, jejichž find ID je v DB bez EXIF GPS (a nemá explicitní NO_GPS)"
              >
                Filtr: jen bez EXIF GPS ({gpsProblemIds.size})
              </Link>
            ))}
          {scope.slug === "maps" &&
            (onlyNonexistent ? (
              <Link
                href={buildHref({ nonexistent: false, page: 1 })}
                className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 font-medium text-amber-900 hover:bg-amber-100"
              >
                <span aria-hidden>×</span>
                Zrušit „jen zaniklé&ldquo;
              </Link>
            ) : (
              <Link
                href={buildHref({ nonexistent: true, page: 1 })}
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-0.5 hover:bg-gray-50"
              >
                Filtr: jen zaniklé
              </Link>
            ))}
          {scope.slug === "maps" &&
            (onlyAnonymized ? (
              <Link
                href={buildHref({ anonymized: false, page: 1 })}
                className="inline-flex items-center gap-1 rounded-md border border-violet-300 bg-violet-50 px-2 py-0.5 font-medium text-violet-900 hover:bg-violet-100"
              >
                <span aria-hidden>×</span>
                Zrušit „jen anonymizované&ldquo;
              </Link>
            ) : (
              <Link
                href={buildHref({ anonymized: true, page: 1 })}
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-0.5 hover:bg-gray-50"
              >
                Filtr: jen anonymizované
              </Link>
            ))}
        </div>
        {total > PAGE_SIZE_OPTIONS[0] && (
          <div className="flex items-center gap-1">
            <span>Na stránku:</span>
            {PAGE_SIZE_OPTIONS.map((n) => (
              <Link
                key={n}
                href={buildHref({ size: n, page: 1 })}
                className={
                  n === pageSize
                    ? "rounded bg-gray-200 px-1.5 py-0.5 font-semibold text-gray-900"
                    : "rounded px-1.5 py-0.5 hover:bg-gray-100 hover:text-gray-700"
                }
              >
                {n}
              </Link>
            ))}
          </div>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-sm text-gray-500">
          {total === 0 && !query
            ? "Adresář je prázdný (nebo neexistuje)."
            : "Žádný soubor neodpovídá filtru."}
        </div>
      ) : scope.slug === "finds" ? (
        <FilesListClient
          entries={entries}
          scopeSlug={scope.slug}
          bulkDelete={deleteFindsBulk}
          coverageFindIds={counterpartIds}
          missingCoverageLabel={counterpartLabel}
          exifProblemIds={exifProblemIds}
          gpsProblemIds={gpsProblemIds}
        />
      ) : scope.slug === "crops" ? (
        <FilesListClient
          entries={entries}
          scopeSlug={scope.slug}
          bulkDelete={deleteCropsBulk}
          coverageFindIds={counterpartIds}
          missingCoverageLabel={counterpartLabel}
          exifProblemIds={exifProblemIds}
          gpsProblemIds={gpsProblemIds}
        />
      ) : scope.slug === "maps" ? (
        <FilesListClient
          entries={entries}
          scopeSlug={scope.slug}
          bulkDelete={deleteMapsBulk}
          bulkRename={{
            label: "Označit jako zaniklé",
            confirmTemplate:
              "Přejmenovat {n} položek s prefixem NEEXISTUJE-?",
            action: markMapsNonexistentBulk,
          }}
          anonymizedNames={anonymizedNamesNFC}
          mapsWithRealPhoto={mapsWithRealPhoto}
          showNonexistentBadge
        />
      ) : scope.slug === "donation-photos" ? (
        <FilesListClient
          entries={entries}
          scopeSlug={scope.slug}
          bulkDelete={deleteDonationPhotosBulk}
        />
      ) : scope.slug === "location-photos" ? (
        <FilesListClient
          entries={entries}
          scopeSlug={scope.slug}
          bulkDelete={deleteLocationPhotosBulk}
        />
      ) : (
        // Remaining scopes (meta) keep the simple read-only listing —
        // there's no bulk write surface for the JSON / config files.
        <ul className="divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200 bg-white">
          {entries.map((e) => {
            const href = `/admin/files/${scope.slug}/${encodeURIComponent(e.name)}`;
            const isImg = isImageName(e.name);
            return (
              <li key={e.name}>
                <Link
                  href={href}
                  className="flex items-center gap-3 px-3 py-2 text-sm transition hover:bg-gray-50"
                >
                  {isImg ? (
                    <ImageIcon
                      className="h-4 w-4 shrink-0 text-brand-600"
                      aria-hidden
                    />
                  ) : (
                    <FileText
                      className="h-4 w-4 shrink-0 text-gray-500"
                      aria-hidden
                    />
                  )}
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-xs text-gray-900"
                    title={e.name}
                  >
                    {e.name}
                  </span>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-gray-500">
                    {fmtSize(e.size)}
                  </span>
                  <span className="hidden shrink-0 font-mono text-xs tabular-nums text-gray-400 sm:inline">
                    {new Date(e.mtime).toLocaleDateString("cs-CZ")}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <Link
            href={buildHref({ page: Math.max(1, page - 1) })}
            aria-disabled={page <= 1}
            className={`inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 transition hover:bg-gray-50 ${
              page <= 1 ? "pointer-events-none opacity-40" : ""
            }`}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
            Předchozí
          </Link>
          <span>
            Stránka {page} / {totalPages}
          </span>
          <Link
            href={buildHref({ page: Math.min(totalPages, page + 1) })}
            aria-disabled={page >= totalPages}
            className={`inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 transition hover:bg-gray-50 ${
              page >= totalPages ? "pointer-events-none opacity-40" : ""
            }`}
          >
            Další
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      )}
    </div>
  );
}
