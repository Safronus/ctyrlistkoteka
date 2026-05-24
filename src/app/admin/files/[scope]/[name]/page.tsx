import Link from "next/link";
import { notFound } from "next/navigation";
import { promises as fs } from "node:fs";
import {
  ArrowLeft,
  Download,
  FileText,
  Image as ImageIcon,
} from "lucide-react";
import { ensureAdminAuth } from "@/lib/admin/guard";
import { formatJsonCompactArrays } from "@/lib/admin/jsonFormat";
import { readMapAnonFlagFor } from "@/lib/admin/mapAnon";
import {
  analyzeLokaceStavyPoznamky,
  type LSPAnalysis,
} from "@/lib/admin/lokaceStavyAnalysis";
import { ADMIN_ROOTS } from "@/lib/admin/paths";
import {
  findOriginalFilenameById,
  getScope,
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
import { FindState } from "@prisma/client";
import { DeleteCropButton } from "../../crops/delete-button";
import { DeleteDonationPhotoButton } from "../../donation-photos/delete-button";
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
import { MapRealPhotoCard } from "../../maps/real-photo-card";
import { MapReplaceDropzone } from "../../maps/replace-dropzone";
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
  if (!info) notFound();

  const fileUrl = `/api/admin/file?scope=${encodeURIComponent(
    scope.slug,
  )}&name=${encodeURIComponent(info.name)}`;

  const isMetaJson =
    scope.slug === "meta" && info.name === LOKACE_STAVY_POZNAMKY_FILENAME;

  // Map detail needs the current anonymisation state (PNG tEXt
  // `Anonymizovaná lokace=Ano`) to decide which side of the toggle
  // button to show. The shared cache in mapAnon.ts means a fresh
  // listing already populated this name; misses cost one 64 KB read.
  const isMapAnonymized =
    scope.slug === "maps"
      ? ((await readMapAnonFlagFor(info.absolutePath, info.name)) ?? false)
      : false;

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
              </>
            )}
            {scope.slug === "crops" && (
              <DeleteCropButton filename={info.name} />
            )}
            {scope.slug === "maps" && (
              <>
                <MapAnonymizeToggleButton
                  filename={info.name}
                  currentlyAnonymized={isMapAnonymized}
                />
                <MarkMapNonexistentButton filename={info.name} />
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
              <DeleteDonationPhotoButton filename={info.name} />
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

      {scope.slug === "maps" &&
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

      {scope.slug === "maps" && !info.name.startsWith("NEEXISTUJE-") && (
        <MapReplaceDropzone targetName={info.name} />
      )}

      {scope.slug === "maps" && (
        <MapMetadataPreview
          filename={info.name}
          absolutePath={info.absolutePath}
        />
      )}

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
              the file isn't on a public URL anyway. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={fileUrl}
            alt={info.name}
            className="mx-auto max-h-[70vh] w-auto rounded"
          />
        </figure>
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
