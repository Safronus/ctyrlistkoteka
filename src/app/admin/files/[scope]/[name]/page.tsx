import Link from "next/link";
import { notFound } from "next/navigation";
import { promises as fs } from "node:fs";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Image as ImageIcon,
  Map as MapIcon,
} from "lucide-react";
import { ensureAdminAuth } from "@/lib/admin/guard";
import { formatJsonCompactArrays } from "@/lib/admin/jsonFormat";
import { readMapAnonFlagFor } from "@/lib/admin/mapAnon";
import { readMapInventory } from "@/lib/admin/mapsV2";
import { readMapNoteOverrides } from "@/lib/mapNoteOverrides";
import {
  analyzeLokaceStavyPoznamky,
  type LSPAnalysis,
} from "@/lib/admin/lokaceStavyAnalysis";
import { ADMIN_ROOTS } from "@/lib/admin/paths";
import {
  findOriginalFilenameById,
  getScope,
  getScopeNeighbors,
  statScopeFile,
} from "@/lib/admin/scopes";
import { checkSyncNeeded } from "@/lib/admin/syncNeeded";
import {
  LOKACE_STAVY_POZNAMKY_FILENAME,
  type LokaceStavyPoznamky,
  lokaceStavyPoznamkySchema,
  SECTION_KEYS,
  SECTION_LABELS,
  type SectionKey,
} from "@/lib/admin/jsonSchema";
import { parseFindFilename } from "@/lib/parseFilename";
import { FindState, ImageType } from "@/generated/prisma/enums";
import { DeleteCropButton } from "../../crops/delete-button";
import { renameCrop } from "../../crops/rename-action";
import { renameFindOriginal } from "../../finds/rename-action";
import { renameMapFile } from "../../maps/rename-action";
import { RenameButton } from "../../_shared/rename-button";
import { DonationPhotoAnonymizeToggleButton } from "../../donation-photos/anonymize-toggle-button";
import { DeleteDonationPhotoButton } from "../../donation-photos/delete-button";
import { UnlockCodePanel } from "../../donation-photos/unlock-code-panel";
import { DeleteFreePhotoButton } from "../../free-photos/delete-button";
import { DeleteFindButton } from "../../finds/delete-button";
import { FindAnonymizeToggleButton } from "../../finds/anonymize-toggle-button";
import { FindDonationPhotosCard } from "../../finds/donation-photos-card";
import { FindFreePhotosCard } from "../../finds/free-photos-card";
import { FindGigantToggleButton } from "../../finds/gigant-toggle-button";
import { FindQrButton } from "../../finds/qr-button";
import { MarkDonatedButton } from "../../finds/mark-donated-button";
import { UnmarkDonatedButton } from "../../finds/unmark-donated-button";
import { parseRanges } from "@/lib/parseRanges";
import { DeleteLocationPhotoButton } from "../../location-photos/delete-button";
import { MapAnonymizeToggleButton } from "../../maps/anonymize-toggle-button";
import { DeleteMapButton } from "../../maps/delete-button";
import { MapDescriptionEditor } from "../../maps/description-editor";
import { MarkMapNonexistentButton } from "../../maps/mark-nonexistent-button";
import { MapMetadataPreview } from "../../maps/metadata-preview";
import { MapV2Detail } from "../../maps/map-v2-detail";
import { MapRealPhotoCard } from "../../maps/real-photo-card";
import { MapReplaceDropzone } from "../../maps/replace-dropzone";
import { prisma } from "@/lib/db";
import { versionedPhotoUrl } from "@/lib/assetVersion";
import { getFindPhotos } from "@/lib/findPhotos";
import { getFindFreePhotos } from "@/lib/findFreePhotos";
import { resolveLocationMapPhoto } from "@/lib/locationPhotos";
import { SyncNeededBanner } from "../../_shared/sync-needed-banner";
import { JsonSectionsPreview } from "./json-sections-preview";
import { LokaceStavyPoznamkyPreview } from "./lokace-stavy-preview";

const MAX_TEXT_PREVIEW_BYTES = 256 * 1024;

interface PageProps {
  params: Promise<{ scope: string; name: string }>;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isPreviewableImage(contentType: string): boolean {
  // HEIC/HEIF can't be displayed by Chrome/Firefox even though Safari
  // tries — render only the formats every modern browser handles.
  return [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
  ].includes(contentType);
}

function isTextLike(contentType: string): boolean {
  return (
    contentType === "application/json" ||
    contentType.startsWith("text/")
  );
}

export default async function AdminFileDetailPage({ params }: PageProps) {
  await ensureAdminAuth();
  const { scope: scopeSlug, name: encodedName } = await params;
  const name = decodeURIComponent(encodedName);
  const scope = getScope(scopeSlug);
  if (!scope) notFound();
  const info = await statScopeFile(scope, name).catch(() => null);
  // Resolve prev/next neighbours for the same scope's sorted listing
  // so the detail page can offer keyboard-free hopping through the
  // batch — saves clicking back to the list between every row.
  // Single readdir per render, cheap for admin's traffic. Skipped
  // when the current file doesn't exist (we'd 404 below anyway).
  const neighbors = info
    ? await getScopeNeighbors(scope, info.name)
    : { prev: null, next: null, index: -1, total: 0 };
  if (!info) notFound();

  // Mtime suffix busts the browser's max-age=60 cache after a
  // replace. Without it, the admin detail page showed the old map
  // PNG for up to a minute after the replace landed on disk — even
  // a manual reload kept hitting the cache because the URL was
  // identical. With the suffix every mtime change yields a new URL,
  // and the underlying ETag still lets the browser short-circuit
  // unchanged fetches via 304.
  const fileVersion = Date.parse(info.mtime).toString(36);
  const fileUrl = `/api/admin/file?scope=${encodeURIComponent(
    scope.slug,
  )}&name=${encodeURIComponent(info.name)}&v=${fileVersion}`;

  const isMetaJson =
    scope.slug === "meta" && info.name === LOKACE_STAVY_POZNAMKY_FILENAME;

  // Is this map in data/maps/manifest.json? If so it's a v2 map — the
  // manifest is authoritative for its metadata + anon flag, and the v1
  // per-file mutation UI (rename / delete / mark-nonexistent / anonymize /
  // replace / description edit) is hidden. Only stray flat v1 PNGs (not in
  // the manifest) keep the legacy controls.
  const mapV2Entry =
    scope.slug === "maps"
      ? ((await readMapInventory())?.find(
          (e) => e.nosnaName.normalize("NFC") === info.name.normalize("NFC"),
        ) ?? null)
      : null;

  // Map detail needs the current anonymisation state. For v2 it comes from
  // the manifest; for a stray v1 PNG, from the tEXt `Anonymizovaná lokace`
  // flag (one 64 KB read, cached by mapAnon.ts).
  const isMapAnonymized =
    scope.slug === "maps"
      ? mapV2Entry
        ? mapV2Entry.anonymized
        : ((await readMapAnonFlagFor(info.absolutePath, info.name)) ?? false)
      : false;

  // Current web-caption override for this v2 map (keyed by číslo), pre-filling
  // the note editor on the v2 detail card.
  const mapNoteOverride = mapV2Entry
    ? (await readMapNoteOverrides()).get(mapV2Entry.cislo)
    : undefined;

  // Find detail morphs between two transitions based on the parsed
  // state token: NORMÁLNÍ → DAROVANY (with required note) and the
  // inverse DAROVANY → NORMÁLNÍ (clears note). Any other state means
  // neither button shows — the find is in a state we don't model
  // here yet (BEZGPS, ZTRACENÝ, …).
  // Anonymisation flag (pole 5) is parsed from the same call so the
  // anon toggle picks the right side.
  const findParsed =
    scope.slug === "finds" ? parseFindFilename(info.name) : null;
  const findStateInName = findParsed?.ok ? findParsed.value.state : null;
  const canMarkDonated = findStateInName === FindState.NORMAL;
  const canUnmarkDonated = findStateInName === FindState.DONATED;
  const findAnonInName = findParsed?.ok
    ? findParsed.value.isAnonymized
    : false;

  // Is this find currently flagged GIGANT in LokaceStavyPoznamky.json?
  // Read the meta file inline — it's small (< 256 KB), cached by the
  // OS page cache between renders, and the alternative (pre-loading
  // the whole JSON on every scope page) would be wasteful for the
  // 5 % of cases that hit this branch.
  const findIsGigant: boolean = findParsed?.ok
    ? (await readGigantFindIds()).has(findParsed.value.findId)
    : false;

  let textPreview: { content: string; truncated: boolean } | null = null;
  let sectionsPreview:
    | { key: SectionKey; label: string; content: string }[]
    | null = null;
  let lspAnalysis: LSPAnalysis | null = null;
  let lspPoznamky: Record<string, string> | null = null;

  if (isTextLike(info.contentType) && info.size <= MAX_TEXT_PREVIEW_BYTES * 4) {
    const raw = await fs.readFile(info.absolutePath, "utf8");
    if (info.contentType === "application/json") {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (isMetaJson && parsed && typeof parsed === "object") {
          // Render the four logical sections as separate panels, mirroring
          // the editor layout — and use the compact-arrays formatter so a
          // single location's range list renders on one line instead of
          // exploding to 30+ rows.
          sectionsPreview = SECTION_KEYS.map((key) => ({
            key,
            label: SECTION_LABELS[key],
            content: formatJsonCompactArrays(parsed[key] ?? null),
          }));
          // Best-effort schema validation — anomaly stats need typed
          // ranges. If the live file has a Zod regression we silently
          // skip the stats (the tabs still render and the editor has
          // its own error surface).
          const safe = lokaceStavyPoznamkySchema.safeParse(parsed);
          if (safe.success) {
            const data = safe.data as LokaceStavyPoznamky;
            lspAnalysis = analyzeLokaceStavyPoznamky(data);
            lspPoznamky = data.poznamky;
          }
        } else {
          textPreview = {
            content: formatJsonCompactArrays(parsed),
            truncated: false,
          };
        }
      } catch {
        textPreview = { content: raw, truncated: false };
      }
    } else {
      const truncated = raw.length > MAX_TEXT_PREVIEW_BYTES;
      textPreview = {
        content: truncated ? raw.slice(0, MAX_TEXT_PREVIEW_BYTES) : raw,
        truncated,
      };
    }
  }

  // Sync-needed banner — relevant only on the LokaceStavyPoznamky.json
  // detail (data/meta/). Other meta files don't drive sync directly.
  const metaSyncProps = isMetaJson
    ? {
        result: await checkSyncNeeded(["meta"]),
        preset: "meta" as const,
        label: "LokaceStavyPoznamky.json",
      }
    : null;

  // For map detail: look up any real-life photo bound to this map.
  // `info.name` doubles as the DB-stored originalFilename (sync writes
  // it that way), so the same lookup the public site uses works here.
  // Anonymized maps don't surface their photo on the public site, and
  // we mirror that here — hides the upload card too because it would
  // be confusing to allow uploading a photo that wouldn't render.
  const mapRealPhoto =
    scope.slug === "maps" && !isMapAnonymized
      ? await resolveLocationMapPhoto({
          originalFilename: info.name,
          isAnonymized: false,
        })
      : null;

  // For find detail: list every donation photo on disk for this find.
  // The parser already gave us findId — reuse it to read the public
  // dirCache so the admin and the public /sbirka/<id> page agree on
  // what exists. Anonymized photos come back with `url: null`; the
  // card renders an EyeOff placeholder for those.
  const findDonationPhotos =
    scope.slug === "finds" && findParsed?.ok
      ? await getFindPhotos(findParsed.value.findId)
      : [];

  // Same shape as donation photos but for the free-photo gallery. The
  // public site reads from the same lib; the admin reuses it so both
  // sides agree on what exists.
  const findFreePhotos =
    scope.slug === "finds" && findParsed?.ok
      ? await getFindFreePhotos(findParsed.value.findId)
      : [];

  // Generated WebP variant for this source original / crop — lets the detail
  // link straight to what the site actually serves (watermark, portrait
  // orientation, quality). `info.name` is the DB-stored originalFilename;
  // scope disambiguates ORIGINAL vs CROP (they can share a basename across
  // data/finds and data/crops).
  const generatedWebp =
    scope.slug === "finds" || scope.slug === "crops"
      ? await prisma.findImage.findFirst({
          where: {
            originalFilename: info.name,
            imageType:
              scope.slug === "crops" ? ImageType.CROP : ImageType.ORIGINAL,
          },
          select: { webPath: true, thumbPath: true },
        })
      : null;

  // For photo-detail pages (donation + free), resolve the find ID
  // embedded in the photo filename back to the matching original on
  // disk so we can offer a one-click "back to original" link. The
  // photo filename pattern is `<findId><slot>_DAR…` or
  // `<findId><slot>_FOTO…` — both share the same leading-digit run
  // convention. When the original isn't on disk we still surface a
  // shallower fallback link to the finds listing filtered by that ID.
  const photoFindIdMatch =
    scope.slug === "donation-photos" || scope.slug === "free-photos"
      ? /^(\d+)/.exec(info.name)
      : null;
  const photoFindId = photoFindIdMatch
    ? Number(photoFindIdMatch[1])
    : null;
  const photoOriginalName =
    photoFindId !== null
      ? await findOriginalFilenameById(photoFindId)
      : null;

  // Per-find unlock code lookup — only the donation-photos detail page
  // exposes the panel that mutates this column (free-photos are never
  // anonymous, so they don't need an unlock code). Single SELECT keyed
  // by the find id parsed from the photo filename. `null` for the
  // whole row means the find doesn't exist yet (sync hasn't run); the
  // panel hides in that case. A row with unlockCode = null is fine —
  // the panel shows the empty editor state.
  const unlockCodeRow =
    scope.slug === "donation-photos" && photoFindId !== null
      ? await prisma.find.findUnique({
          where: { id: photoFindId },
          select: { unlockCode: true },
        })
      : null;

  // Donation-photo anonymization is encoded in the filename's `_ANON`
  // token — same convention as the public file reader uses to decide
  // whether to block via Nginx. Cheap regex match here so the action
  // row can render the right toggle (Anonymizovat vs. Zrušit
  // anonymizaci) and the action server-side double-checks before any
  // rename.
  const donationPhotoIsAnonymized =
    scope.slug === "donation-photos" &&
    /_DAR_ANON\.[A-Za-z]+$/i.test(info.name);

  // Location-map cross-link for find originals — the filename's
  // MAP_NUMBER segment is the LocationMap.id, so a single
  // findUnique resolves the matching map's on-disk filename for
  // the "Lokační mapa" deep-link button in the action row. Null
  // when the map isn't synced yet (rare, but the button hides in
  // that case rather than 404ing on a missing detail URL).
  const linkedMap =
    scope.slug === "finds" && findParsed?.ok
      ? await prisma.locationMap.findUnique({
          where: { id: findParsed.value.mapNumber },
          select: { id: true, originalFilename: true, locationCode: true },
        })
      : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-500">
        <div className="flex items-center gap-2">
          <Link
            href="/admin/files"
            className="inline-flex items-center gap-1 hover:text-gray-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Soubory
          </Link>
          <span aria-hidden>/</span>
          <Link
            href={`/admin/files/${scope.slug}`}
            className="hover:text-gray-900"
          >
            {scope.label}
          </Link>
          <span aria-hidden>/</span>
          <span className="truncate text-gray-900" title={info.name}>
            {info.name}
          </span>
        </div>
        {/* Prev/next within the same scope's sorted listing. The
            position counter (`5 / 1248`) is the same sort the file
            list uses; clicking past either edge wouldn't have a
            target so the boundary button just disables itself. The
            UI lives in the breadcrumb row so it doesn't crowd the
            file-action row below, which is per-scope busy enough. */}
        {neighbors.total > 0 && (
          <div className="inline-flex items-center gap-1 text-xs">
            {neighbors.prev ? (
              <Link
                href={`/admin/files/${scope.slug}/${encodeURIComponent(neighbors.prev)}`}
                title={neighbors.prev}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-gray-300 bg-white px-2 font-medium text-gray-700 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800"
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
                <span className="hidden sm:inline">Předchozí</span>
              </Link>
            ) : (
              <span
                aria-disabled
                className="inline-flex h-7 items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 font-medium text-gray-400"
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
                <span className="hidden sm:inline">Předchozí</span>
              </span>
            )}
            {neighbors.index >= 0 && (
              <span className="px-1.5 font-mono tabular-nums text-gray-500">
                {neighbors.index + 1}
                <span className="text-gray-400"> / </span>
                {neighbors.total}
              </span>
            )}
            {neighbors.next ? (
              <Link
                href={`/admin/files/${scope.slug}/${encodeURIComponent(neighbors.next)}`}
                title={neighbors.next}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-gray-300 bg-white px-2 font-medium text-gray-700 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800"
              >
                <span className="hidden sm:inline">Další</span>
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            ) : (
              <span
                aria-disabled
                className="inline-flex h-7 items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 font-medium text-gray-400"
              >
                <span className="hidden sm:inline">Další</span>
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </span>
            )}
          </div>
        )}
      </div>

      <header className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-start gap-3">
          {info.contentType.startsWith("image/") ? (
            <ImageIcon
              className="mt-0.5 h-5 w-5 shrink-0 text-brand-600"
              aria-hidden
            />
          ) : (
            <FileText
              className="mt-0.5 h-5 w-5 shrink-0 text-gray-500"
              aria-hidden
            />
          )}
          <div className="min-w-0 flex-1">
            <h1
              className="break-all font-mono text-sm font-semibold text-gray-900"
              title={info.name}
            >
              {info.name}
            </h1>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600 sm:grid-cols-4">
              <div>
                <dt className="text-gray-400">Velikost</dt>
                <dd className="font-mono tabular-nums">{fmtSize(info.size)}</dd>
              </div>
              <div>
                <dt className="text-gray-400">Typ</dt>
                <dd className="font-mono">{info.contentType}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-gray-400">Změněno</dt>
                <dd className="font-mono tabular-nums">
                  {new Date(info.mtime).toLocaleString("cs-CZ", {
                    timeZone: "Europe/Prague",
                  })}
                </dd>
              </div>
            </dl>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {scope.slug === "finds" && (
              <>
                {/* State toggles — non-destructive flag/state mutations. */}
                {findParsed?.ok && (
                  <FindAnonymizeToggleButton
                    filename={info.name}
                    currentlyAnonymized={findAnonInName}
                  />
                )}
                {findParsed?.ok && (
                  <FindGigantToggleButton
                    filename={info.name}
                    currentlyGigant={findIsGigant}
                  />
                )}
                {canMarkDonated && (
                  <MarkDonatedButton filename={info.name} />
                )}
                {canUnmarkDonated && (
                  <UnmarkDonatedButton filename={info.name} />
                )}
                {/* Exports group — visual gap from state toggles via a
                    1px divider so the user reads "different kind of
                    action" without needing the text. QR + raw download
                    are both read-only outputs. */}
                {findParsed?.ok && (
                  <div
                    className="mx-1 h-6 w-px shrink-0 bg-gray-300"
                    aria-hidden
                  />
                )}
                {findParsed?.ok && (
                  <FindQrButton findId={findParsed.value.findId} />
                )}
                {/* Generic free-form rename — sibling of the state
                    toggles but lets the operator edit any segment
                    (typo in location code, manual state correction
                    that bulk-toggles don't cover, etc.). The action
                    re-validates via parseFindFilename + auto-renames
                    a matching long-form crop in lockstep. */}
                <RenameButton
                  currentName={info.name}
                  scopeSlug="finds"
                  action={renameFindOriginal}
                />
                {/* Deep-link to the linked LocationMap detail. The
                    MAP_NUMBER in the filename binds to LocationMap.id
                    1:1, so we can land the operator straight on the
                    map for context (descriptions, AOI polygon edits,
                    real-life photo). Hidden when the map isn't on
                    disk yet — typically means sync hasn't seen it. */}
                {linkedMap && (
                  <Link
                    href={`/admin/files/maps/${encodeURIComponent(linkedMap.originalFilename)}`}
                    className="inline-flex items-center gap-1.5 rounded-md border border-brand-300 bg-brand-50 px-2.5 py-1.5 text-xs font-medium text-brand-800 transition hover:border-brand-400 hover:bg-brand-100"
                    title={`Otevřít lokační mapu ${linkedMap.locationCode} (#${linkedMap.id.toString().padStart(5, "0")})`}
                  >
                    <MapIcon className="h-3.5 w-3.5" aria-hidden />
                    Lokační mapa #{linkedMap.id.toString().padStart(5, "0")}
                  </Link>
                )}
              </>
            )}
            {scope.slug === "crops" && (
              <>
                <RenameButton
                  currentName={info.name}
                  scopeSlug="crops"
                  action={renameCrop}
                />
                <DeleteCropButton filename={info.name} />
              </>
            )}
            {/* v1 per-file mutation controls — only for stray flat v1 PNGs
                (not in the manifest). v2 maps are managed as a whole via
                /admin/import, so they show none of these. */}
            {scope.slug === "maps" && !mapV2Entry && (
              <>
                <MapAnonymizeToggleButton
                  filename={info.name}
                  currentlyAnonymized={isMapAnonymized}
                />
                <MarkMapNonexistentButton filename={info.name} />
                <RenameButton
                  currentName={info.name}
                  scopeSlug="maps"
                  action={renameMapFile}
                />
                <DeleteMapButton filename={info.name} />
              </>
            )}
            {(scope.slug === "donation-photos" ||
              scope.slug === "free-photos") &&
              photoFindId !== null && (
                <Link
                  // Prefer the direct deep-link to the find original's
                  // detail page; fall back to the finds listing filtered
                  // by ID when the original isn't on disk. Either way
                  // the user gets back to the find's context in one
                  // click.
                  href={
                    photoOriginalName
                      ? `/admin/files/finds/${encodeURIComponent(photoOriginalName)}`
                      : `/admin/files/finds?q=${photoFindId}`
                  }
                  className="inline-flex items-center gap-1.5 rounded-md border border-brand-300 bg-brand-50 px-2.5 py-1.5 text-xs font-medium text-brand-800 transition hover:border-brand-400 hover:bg-brand-100"
                  title={
                    photoOriginalName
                      ? `Otevřít originál nálezu #${photoFindId}`
                      : `Najít originál nálezu #${photoFindId}`
                  }
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                  Originál nálezu #{photoFindId}
                </Link>
              )}
            {scope.slug === "donation-photos" && (
              <>
                <DonationPhotoAnonymizeToggleButton
                  filename={info.name}
                  currentlyAnonymized={donationPhotoIsAnonymized}
                />
                <DeleteDonationPhotoButton filename={info.name} />
              </>
            )}
            {scope.slug === "free-photos" && (
              <DeleteFreePhotoButton filename={info.name} />
            )}
            {scope.slug === "location-photos" && (
              <DeleteLocationPhotoButton filename={info.name} />
            )}
            {scope.slug === "meta" &&
              info.name === LOKACE_STAVY_POZNAMKY_FILENAME && (
                <Link
                  href="/admin/json/lokace-stavy-poznamky"
                  className="inline-flex items-center gap-1.5 rounded-md border border-brand-300 bg-brand-50 px-2.5 py-1.5 text-xs font-medium text-brand-800 transition hover:border-brand-400 hover:bg-brand-100"
                >
                  Upravit v editoru
                </Link>
              )}
            <a
              href={fileUrl}
              download={info.name}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 transition hover:border-gray-400 hover:bg-gray-50"
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              Stáhnout
            </a>
            {/* Destructive action — pushed to the end, separated by a
                divider so a stray click in the toggle/export area
                can't hit Delete. Finds only; other scopes keep their
                Delete inline above (lower-stakes deletes). */}
            {scope.slug === "finds" && (
              <>
                <div
                  className="mx-1 h-6 w-px shrink-0 bg-gray-300"
                  aria-hidden
                />
                <DeleteFindButton filename={info.name} />
              </>
            )}
          </div>
        </div>
      </header>

      {/* Filename-description editor + byte-replace — v1 flat PNGs only.
          v2 maps carry their description in the manifest and are replaced
          through /admin/import. */}
      {scope.slug === "maps" &&
        !mapV2Entry &&
        (() => {
          const dot = info.name.lastIndexOf(".");
          const stem = dot === -1 ? info.name : info.name.slice(0, dot);
          // The NEEXISTUJE- prefix sits in front of the canonical
          // 6-segment basename — strip it before counting so the
          // editor stays available on zaniklé maps too.
          const coreStem = stem.startsWith("NEEXISTUJE-")
            ? stem.slice("NEEXISTUJE-".length)
            : stem;
          const segs = coreStem.split("+");
          if (segs.length !== 6) return null;
          return (
            <MapDescriptionEditor
              filename={info.name}
              currentDescription={segs[1] ?? ""}
            />
          );
        })()}

      {scope.slug === "maps" &&
        !mapV2Entry &&
        !info.name.startsWith("NEEXISTUJE-") && (
          <MapReplaceDropzone targetName={info.name} />
        )}

      {/* v2 maps → manifest-driven metadata card + web-caption editor.
          Stray v1 PNGs → the legacy filename/tEXt metadata preview. */}
      {scope.slug === "maps" &&
        (mapV2Entry ? (
          <MapV2Detail entry={mapV2Entry} noteOverride={mapNoteOverride} />
        ) : (
          <MapMetadataPreview
            filename={info.name}
            absolutePath={info.absolutePath}
          />
        ))}

      {scope.slug === "maps" && !isMapAnonymized && (
        <MapRealPhotoCard mapName={info.name} existingPhoto={mapRealPhoto} />
      )}

      {scope.slug === "finds" && findParsed?.ok && (
        <FindDonationPhotosCard
          findId={findParsed.value.findId}
          existing={findDonationPhotos}
          findIsAnonymizedDefault={findAnonInName}
        />
      )}

      {scope.slug === "finds" && findParsed?.ok && (
        <FindFreePhotosCard
          findId={findParsed.value.findId}
          existing={findFreePhotos}
        />
      )}

      {isPreviewableImage(info.contentType) && (
        <figure className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50 p-2">
          {/* `<img>` rather than next/image — admin previews are
              one-off, no need to push them through the optimizer +
              the file isn't on a public URL anyway. `block` cancels
              the default inline baseline gap that otherwise leaves a
              ~4 px strip of figure background visible under the
              image. max-h lives directly on the <img>: percentage
              max-heights (max-h-full) need an explicit parent
              height to resolve, but vh units are viewport-relative
              and reliable regardless of parent sizing — earlier
              attempt to cap via the figure failed because the
              figure's height was `auto` and the image fell back to
              its intrinsic pixel size, overflowing the page. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={fileUrl}
            alt={info.name}
            className="mx-auto block max-h-[60vh] w-auto rounded"
          />
        </figure>
      )}

      {/* Click-through to the generated WebP variant the site actually serves
          (watermark, portrait orientation, quality) — handy for eyeballing the
          derived output, and the only preview for HEIC sources the browser
          can't render. `?v=` cache-busts to the current asset version. */}
      {generatedWebp?.webPath && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-gray-500">Vygenerovaná WebP verze:</span>
          <a
            href={versionedPhotoUrl(generatedWebp.webPath)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-brand-200 bg-brand-50 px-2.5 py-1 font-medium text-brand-700 transition hover:bg-brand-100"
          >
            web →
          </a>
          {generatedWebp.thumbPath && (
            <a
              href={versionedPhotoUrl(generatedWebp.thumbPath)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1 font-medium text-gray-700 transition hover:bg-gray-100"
            >
              thumb →
            </a>
          )}
        </div>
      )}

      {/* Per-find unlock code editor — donation-photos detail only.
          Sits below the photo preview so the operator sees what
          photo they're configuring the code for, then the panel
          right under it. Free-photos (the public variant) doesn't
          get this panel because those photos aren't anonymous and
          have no unlock flow. */}
      {scope.slug === "donation-photos" &&
        photoFindId !== null &&
        unlockCodeRow !== null && (
          <UnlockCodePanel
            findId={photoFindId}
            initialCode={unlockCodeRow.unlockCode}
          />
        )}

      {!isPreviewableImage(info.contentType) &&
        info.contentType.startsWith("image/") && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            HEIC/HEIF náhled prohlížeče běžně nezobrazí. Stáhni soubor a otevři
            v Náhledu (macOS) nebo si pusť server-side WebP variantu z{" "}
            <code>{`/generated/`}</code> (po sync).
          </div>
        )}

      {metaSyncProps && (
        <SyncNeededBanner
          result={metaSyncProps.result}
          preset={metaSyncProps.preset}
          label={metaSyncProps.label}
        />
      )}

      {sectionsPreview &&
        (lspAnalysis && lspPoznamky ? (
          <LokaceStavyPoznamkyPreview
            sections={sectionsPreview}
            analysis={lspAnalysis}
            poznamky={lspPoznamky}
          />
        ) : (
          <JsonSectionsPreview sections={sectionsPreview} />
        ))}

      {textPreview && (
        <pre className="max-h-[70vh] overflow-auto rounded-xl border border-gray-200 bg-gray-900 p-4 text-xs leading-relaxed text-gray-100">
          {textPreview.content}
          {textPreview.truncated && "\n\n… [truncated]"}
        </pre>
      )}
    </div>
  );
}

/** Reads the current GIGANT find-id set from LokaceStavyPoznamky.json.
 *  Tolerates a missing file (returns empty set) and any JSON parse /
 *  schema error (also empty set + console.warn) — the find-detail
 *  toggle defaults to "not gigant" then, which the operator can flip
 *  to true with one click anyway. The full validation happens at
 *  toggle-time inside the server action. */
async function readGigantFindIds(): Promise<Set<number>> {
  const target = `${ADMIN_ROOTS.meta}/${LOKACE_STAVY_POZNAMKY_FILENAME}`;
  try {
    const raw = await fs.readFile(target, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const stavy = (parsed.stavy ?? {}) as Record<string, unknown>;
    const gigant = stavy.GIGANT;
    if (!Array.isArray(gigant)) return new Set();
    const stringEntries = gigant.filter((x): x is string => typeof x === "string");
    return new Set(parseRanges(stringEntries));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return new Set();
    console.warn("[admin/finds] readGigantFindIds failed", err);
    return new Set();
  }
}
