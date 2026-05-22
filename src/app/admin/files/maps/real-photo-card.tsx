"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  CloudUpload,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  X,
  XCircle,
} from "lucide-react";
import { uploadMapRealPhoto } from "./photo-upload-action";

interface Props {
  /** The map's on-disk filename — the action uses it to derive the
   *  destination basename so the uploaded photo binds to this map. */
  mapName: string;
  /** Existing photo bound to this map, if any. When present the card
   *  shows the photo + a deep-link into its own admin detail (where
   *  the user can delete it). When null, the dropzone is rendered. */
  existingPhoto: { filename: string; url: string } | null;
}

const ACCEPT = ".jpg,.jpeg,.png,.webp";
const MAX_BYTES = 25 * 1024 * 1024;

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Map-detail card that pairs the existing real-photo preview (if any)
 *  with a single-file upload dropzone. Mirrors `MapReplaceDropzone`
 *  visually but talks to the dedicated `uploadMapRealPhoto` action
 *  which (a) ignores the file's own name and writes
 *  `<mapBaseName>_reálné foto.<ext>` instead, and (b) refuses if a
 *  photo for the map already exists — replace path is "open photo
 *  detail → delete → come back and upload". */
export function MapRealPhotoCard({ mapName, existingPhoto }: Props) {
  const [staged, setStaged] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [resultOk, setResultOk] = useState<boolean | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback((list: FileList | File[]) => {
    setResultOk(null);
    setResultMessage(null);
    const files = Array.from(list);
    if (files.length === 0) return;
    if (files.length > 1) {
      setResultOk(false);
      setResultMessage(
        "Upload přijímá jen jeden soubor — vyber přesně jednu fotku.",
      );
      return;
    }
    const f = files[0]!;
    if (f.size > MAX_BYTES) {
      setResultOk(false);
      setResultMessage(`Soubor je větší než ${fmtSize(MAX_BYTES)}`);
      return;
    }
    setStaged(f);
  }, []);

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  };
  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!dragActive) setDragActive(true);
  };
  const onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
  };

  const onSubmit = () => {
    if (!staged || isPending) return;
    setResultOk(null);
    setResultMessage(null);
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.append("mapName", mapName);
        fd.append("file", staged);
        const r = await uploadMapRealPhoto(fd);
        if (r.ok) {
          setResultOk(true);
          setResultMessage(
            `Nahráno jako "${r.filename}" (${r.size !== undefined ? fmtSize(r.size) : "?"}). Sync s --only=maps doplní vazbu.`,
          );
          setStaged(null);
          if (inputRef.current) inputRef.current.value = "";
        } else {
          setResultOk(false);
          setResultMessage(r.error ?? "Upload selhal");
        }
      } catch (err) {
        setResultOk(false);
        setResultMessage(
          err instanceof Error ? err.message : "Upload selhal",
        );
      }
    });
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <header className="mb-3 flex items-center gap-2">
        <ImageIcon className="h-4 w-4 text-brand-600" aria-hidden />
        <h2 className="text-sm font-semibold text-gray-900">
          Reálná fotka lokality
        </h2>
      </header>

      {existingPhoto ? (
        <ExistingPhoto
          mapName={mapName}
          filename={existingPhoto.filename}
          url={existingPhoto.url}
        />
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            Nahraj fotku této lokality v reálu (jakýkoli název). Server
            ji uloží jako{" "}
            <code className="break-all font-mono">
              {`<základ názvu mapy>_reálné foto.<přípona>`}
            </code>{" "}
            do <code className="font-mono">generated/location-photos/</code>,
            aby si ji vytáhl public lookup. Akceptuje JPEG / PNG / WebP, max{" "}
            {fmtSize(MAX_BYTES)}.
          </p>

          <div
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-5 transition ${
              dragActive
                ? "border-brand-500 bg-brand-50/50"
                : "border-gray-300 bg-gray-50 hover:border-gray-400"
            } ${isPending ? "pointer-events-none opacity-60" : ""}`}
          >
            <CloudUpload className="h-7 w-7 text-gray-400" aria-hidden />
            <p className="text-sm text-gray-700">
              Přetáhni fotku sem nebo{" "}
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="font-medium text-brand-700 underline-offset-2 hover:underline"
              >
                vyber soubor
              </button>
            </p>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  handleFiles(e.target.files);
                  e.target.value = "";
                }
              }}
            />
          </div>

          {staged && (
            <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <CloudUpload className="h-4 w-4 shrink-0" aria-hidden />
              <span
                className="min-w-0 flex-1 truncate font-mono"
                title={staged.name}
              >
                {staged.name}
              </span>
              <span className="shrink-0 font-mono tabular-nums">
                {fmtSize(staged.size)}
              </span>
              <button
                type="button"
                onClick={() => setStaged(null)}
                disabled={isPending}
                aria-label="Zahodit výběr"
                className="shrink-0 rounded p-0.5 text-amber-800 hover:bg-amber-100"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={onSubmit}
                disabled={isPending}
                className="inline-flex shrink-0 items-center gap-1 rounded bg-amber-600 px-2 py-0.5 font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isPending && (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                )}
                Nahrát
              </button>
            </div>
          )}
        </div>
      )}

      {resultMessage && (
        <p
          className={`mt-3 inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs ${
            resultOk
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {resultOk ? (
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <XCircle className="h-3.5 w-3.5" aria-hidden />
          )}
          {resultMessage}
        </p>
      )}

      {/* Sync click-through is always visible — the user lands here
       *  for both adding a brand-new photo (which needs no sync, the
       *  public site reads the file straight from disk) and for
       *  re-running sync after a rename/move. `--only=maps` is the
       *  narrowest preset that touches `location_maps` rows. */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
        <Link
          href="/admin/sync?preset=maps"
          className="inline-flex items-center gap-1.5 rounded-md border border-brand-300 bg-brand-50 px-2.5 py-1.5 text-xs font-medium text-brand-800 transition hover:border-brand-400 hover:bg-brand-100"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Sync s --only=maps
        </Link>
        <span className="text-xs text-gray-500">
          Spustí sync s předvolbou jen pro mapy — odhalí vazbu nově
          nahrané fotky.
        </span>
      </div>
    </section>
  );
}

function ExistingPhoto({
  filename,
  url,
}: {
  mapName: string;
  filename: string;
  url: string;
}) {
  return (
    <div className="space-y-3">
      <figure className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50 p-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={filename}
          className="mx-auto max-h-[60vh] w-auto rounded"
        />
      </figure>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <p className="min-w-0 truncate text-gray-500" title={filename}>
          <span className="text-gray-400">Soubor:</span>{" "}
          <code className="break-all font-mono text-gray-700">{filename}</code>
        </p>
        <Link
          href={`/admin/files/location-photos/${encodeURIComponent(filename)}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 font-medium text-gray-700 transition hover:border-gray-400 hover:bg-gray-50"
        >
          <ImageIcon className="h-3.5 w-3.5" aria-hidden />
          Otevřít detail / smazat
        </Link>
      </div>
    </div>
  );
}
