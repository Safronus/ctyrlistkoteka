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
import {
  analyzeLokaceStavyPoznamky,
  type LSPAnalysis,
} from "@/lib/admin/lokaceStavyAnalysis";
import { getScope, statScopeFile } from "@/lib/admin/scopes";
import {
  LOKACE_STAVY_POZNAMKY_FILENAME,
  type LokaceStavyPoznamky,
  lokaceStavyPoznamkySchema,
  SECTION_KEYS,
  SECTION_LABELS,
  type SectionKey,
} from "@/lib/admin/jsonSchema";
import { DeleteCropButton } from "../../crops/delete-button";
import { DeleteDonationPhotoButton } from "../../donation-photos/delete-button";
import { DeleteFindButton } from "../../finds/delete-button";
import { DeleteLocationPhotoButton } from "../../location-photos/delete-button";
import { DeleteMapButton } from "../../maps/delete-button";
import { MapDescriptionEditor } from "../../maps/description-editor";
import { MarkMapNonexistentButton } from "../../maps/mark-nonexistent-button";
import { MapReplaceDropzone } from "../../maps/replace-dropzone";
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
              <DeleteFindButton filename={info.name} />
            )}
            {scope.slug === "crops" && (
              <DeleteCropButton filename={info.name} />
            )}
            {scope.slug === "maps" && (
              <>
                <MarkMapNonexistentButton filename={info.name} />
                <DeleteMapButton filename={info.name} />
              </>
            )}
            {scope.slug === "donation-photos" && (
              <DeleteDonationPhotoButton filename={info.name} />
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
          </div>
        </div>
      </header>

      {scope.slug === "maps" &&
        !info.name.startsWith("NEEXISTUJE-") &&
        (() => {
          const dot = info.name.lastIndexOf(".");
          const stem = dot === -1 ? info.name : info.name.slice(0, dot);
          const segs = stem.split("+");
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
