"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ImagePlus,
  Layers,
  Loader2,
  X,
} from "lucide-react";
import {
  MAX_BATCH_BYTES,
  MAX_BULK_FINDS,
  MAX_BULK_PHOTOS,
  MAX_FILE_BYTES,
  MAX_FILES_PER_REQUEST,
  type BulkAssignResponse,
  type SharedUploadResponse,
} from "./upload-types";

interface PhotoItem {
  id: string;
  file: File;
  /** object URL for the preview thumbnail (revoked on remove/unmount). */
  url: string;
  /** sha1 once the photo has been staged server-side; drives assign. */
  sha1?: string;
}

function slotLetter(i: number): string {
  return String.fromCharCode(97 + i);
}
function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

/** Byte-aware batching so each staging request stays under the ~10 MB
 *  multipart body-truncation cap (same reason as the per-find uploader). */
function splitBatches(items: PhotoItem[]): PhotoItem[][] {
  const batches: PhotoItem[][] = [];
  let cur: PhotoItem[] = [];
  let bytes = 0;
  for (const it of items) {
    const tooMany = cur.length >= MAX_FILES_PER_REQUEST;
    const tooBig = cur.length > 0 && bytes + it.file.size > MAX_BATCH_BYTES;
    if (tooMany || tooBig) {
      batches.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(it);
    bytes += it.file.size;
  }
  if (cur.length > 0) batches.push(cur);
  return batches;
}

async function postStagingBatch(
  batch: PhotoItem[],
): Promise<SharedUploadResponse> {
  const fd = new FormData();
  for (const p of batch) fd.append("files", p.file);
  const r = await fetch("/admin/api/donation-shared-upload", {
    method: "POST",
    body: fd,
  });
  try {
    return (await r.json()) as SharedUploadResponse;
  } catch {
    return {
      results: [],
      error: r.ok
        ? "Server vrátil neparsovatelnou odpověď."
        : `HTTP ${r.status}${r.statusText ? " " + r.statusText : ""}`,
    };
  }
}

async function postAssign(
  sha1s: string[],
  range: string,
  anon: boolean,
  overwrite: boolean,
): Promise<BulkAssignResponse> {
  const r = await fetch("/admin/api/donation-bulk-assign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sha1s, range, anon, overwrite }),
  });
  try {
    return (await r.json()) as BulkAssignResponse;
  } catch {
    return {
      applied: false,
      error: r.ok
        ? "Server vrátil neparsovatelnou odpověď."
        : `HTTP ${r.status}${r.statusText ? " " + r.statusText : ""}`,
    };
  }
}

export function DonationPhotosBulkAssignForm() {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [range, setRange] = useState("");
  const [anon, setAnon] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [result, setResult] = useState<BulkAssignResponse | null>(null);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "uploading" | "assigning">("idle");
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const photosRef = useRef<PhotoItem[]>([]);
  photosRef.current = photos;
  useEffect(
    () => () => {
      for (const p of photosRef.current) URL.revokeObjectURL(p.url);
    },
    [],
  );

  const isPending = phase !== "idle";

  const addPhotos = useCallback((incoming: FileList | File[]) => {
    setBannerError(null);
    setResult(null);
    const list = Array.from(incoming).filter((f) => f.type.startsWith("image/"));
    setPhotos((prev) => {
      const room = MAX_BULK_PHOTOS - prev.length;
      if (room <= 0) {
        setBannerError(`Max ${MAX_BULK_PHOTOS} fotek.`);
        return prev;
      }
      const additions = list.slice(0, room).map((file) => ({
        id: newId(),
        file,
        url: URL.createObjectURL(file),
      }));
      if (list.length > room)
        setBannerError(`Max ${MAX_BULK_PHOTOS} fotek — část se nepřidala.`);
      return [...prev, ...additions];
    });
  }, []);

  const removePhoto = (id: string) =>
    setPhotos((prev) => {
      const gone = prev.find((p) => p.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return prev.filter((p) => p.id !== id);
    });

  const move = (id: string, dir: -1 | 1) =>
    setPhotos((prev) => {
      const i = prev.findIndex((p) => p.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  const clearAll = () => {
    for (const p of photos) URL.revokeObjectURL(p.url);
    setPhotos([]);
    setRange("");
    setResult(null);
    setBannerError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  /** Stages any photos that don't yet have a sha1 (chunked). Returns the
   *  ordered sha1 list, or null on failure (banner already set). */
  const ensureStaged = async (current: PhotoItem[]): Promise<string[] | null> => {
    const pending = current.filter((p) => !p.sha1);
    if (pending.length > 0) {
      setPhase("uploading");
      for (const batch of splitBatches(pending)) {
        const { results, error } = await postStagingBatch(batch);
        if (error) {
          setBannerError(error);
          return null;
        }
        // Map batch-relative index → photo; stamp sha1 into state.
        const staged = new Map<string, string>();
        for (const r of results) {
          const photo = batch[r.index];
          if (!photo) continue;
          if (r.status === "ok" && r.sha1) staged.set(photo.id, r.sha1);
          else {
            setBannerError(
              `Fotku "${photo.file.name}" nešlo nahrát: ${r.reason ?? "neznámá chyba"}`,
            );
            return null;
          }
        }
        setPhotos((prev) =>
          prev.map((p) =>
            staged.has(p.id) ? { ...p, sha1: staged.get(p.id) } : p,
          ),
        );
        for (const [id, sha1] of staged) {
          const p = current.find((x) => x.id === id);
          if (p) p.sha1 = sha1; // keep local copy in sync for the return
        }
      }
    }
    const sha1s = current.map((p) => p.sha1).filter((s): s is string => !!s);
    return sha1s.length === current.length ? sha1s : null;
  };

  const submit = (overwrite: boolean) => {
    if (isPending) return;
    const current = photos;
    if (current.length === 0) {
      setBannerError("Přidej aspoň jednu fotku.");
      return;
    }
    if (range.trim() === "") {
      setBannerError("Zadej rozsah čísel nálezů (např. 16330-16440).");
      return;
    }
    setBannerError(null);
    startTransition(async () => {
      try {
        const sha1s = await ensureStaged(current);
        if (!sha1s) return;
        setPhase("assigning");
        const res = await postAssign(sha1s, range, anon, overwrite);
        setResult(res);
        if (res.error) setBannerError(res.error);
      } finally {
        setPhase("idle");
      }
    });
  };

  const collisions = result?.collisions ?? [];
  const needsOverwrite = result != null && !result.applied && collisions.length > 0;

  return (
    <section className="rounded-xl border border-brand-200 bg-brand-50/40 p-4 shadow-sm">
      <header className="mb-1 flex items-center gap-2">
        <Layers className="h-4 w-4 text-brand-700" aria-hidden />
        <h2 className="text-sm font-semibold text-gray-900">
          Hromadné přiřazení sdílené fotky
        </h2>
      </header>
      <p className="mb-3 text-xs text-gray-600">
        Nahraj pár fotek (jakýkoli formát/název — normalizují se na WebP) a
        přiřaď je rozsahu čísel nálezů. Fotky se uloží <strong>jednou</strong>{" "}
        a všechny nálezy na ně jen odkážou (žádné kopie). Pořadí = sloty{" "}
        <code className="font-mono">a, b, c…</code> Max {MAX_BULK_PHOTOS} fotek,{" "}
        {MAX_BULK_FINDS} nálezů, {fmtSize(MAX_FILE_BYTES)}/fotka.
      </p>

      <div
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          if (e.dataTransfer.files.length > 0) addPhotos(e.dataTransfer.files);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragActive) setDragActive(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragActive(false);
        }}
        className={`flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-4 py-5 transition ${
          dragActive
            ? "border-brand-500 bg-brand-100/50"
            : "border-brand-300 bg-white hover:border-brand-400"
        } ${isPending ? "pointer-events-none opacity-60" : ""}`}
      >
        <ImagePlus className="h-7 w-7 text-brand-400" aria-hidden />
        <p className="text-sm text-gray-700">
          Přetáhni fotky darů sem nebo{" "}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="font-medium text-brand-700 underline-offset-2 hover:underline"
          >
            vyber soubory
          </button>
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              addPhotos(e.target.files);
              e.target.value = "";
            }
          }}
        />
      </div>

      {photos.length > 0 && (
        <ol className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {photos.map((p, i) => (
            <li
              key={p.id}
              className="relative overflow-hidden rounded-lg border border-gray-200 bg-white"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.url}
                alt={p.file.name}
                className="aspect-square w-full object-cover"
              />
              <span className="absolute left-1.5 top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-700 font-mono text-[11px] font-bold text-white shadow">
                {slotLetter(i)}
              </span>
              {p.sha1 && (
                <span
                  className="absolute right-1.5 top-1.5 rounded-full bg-emerald-600 p-0.5 text-white shadow"
                  title="Nahráno"
                >
                  <CheckCircle2 className="h-3 w-3" aria-hidden />
                </span>
              )}
              <div className="flex items-center justify-between gap-1 px-1.5 py-1">
                <span
                  className="min-w-0 flex-1 truncate text-[10px] text-gray-500"
                  title={`${p.file.name} • ${fmtSize(p.file.size)}`}
                >
                  {p.file.name}
                </span>
                <div className="flex shrink-0 items-center">
                  <button
                    type="button"
                    onClick={() => move(p.id, -1)}
                    disabled={i === 0 || isPending}
                    aria-label="Posunout dopředu"
                    className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
                  >
                    <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(p.id, 1)}
                    disabled={i === photos.length - 1 || isPending}
                    aria-label="Posunout dozadu"
                    className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
                  >
                    <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => removePhoto(p.id)}
                    disabled={isPending}
                    aria-label="Odebrat"
                    className="rounded p-0.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex-1 text-xs font-medium text-gray-700">
          Rozsah čísel nálezů
          <input
            type="text"
            value={range}
            onChange={(e) => {
              setRange(e.target.value);
              setResult(null);
            }}
            placeholder="16330-16440, 16500"
            inputMode="numeric"
            className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 font-mono text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </label>
        <label className="flex items-center gap-1.5 py-1.5 text-xs text-gray-700">
          <input
            type="checkbox"
            checked={anon}
            onChange={(e) => {
              setAnon(e.target.checked);
              setResult(null);
            }}
            className="h-3.5 w-3.5 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
          />
          Anonymizované (skryté, jen po odemčení)
        </label>
        <button
          type="button"
          onClick={() => submit(false)}
          disabled={isPending || photos.length === 0}
          className="inline-flex items-center justify-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Layers className="h-3.5 w-3.5" aria-hidden />
          )}
          {phase === "uploading"
            ? "Nahrávám…"
            : phase === "assigning"
              ? "Přiřazuji…"
              : "Přiřadit"}
        </button>
        {(photos.length > 0 || range !== "") && (
          <button
            type="button"
            onClick={clearAll}
            disabled={isPending}
            className="text-xs text-gray-600 hover:text-gray-900 disabled:opacity-50"
          >
            Vyčistit
          </button>
        )}
      </div>

      {bannerError && (
        <p className="mt-2 flex items-start gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{bannerError}</span>
        </p>
      )}

      {result && !result.error && (
        <div className="mt-2 space-y-1.5 text-xs">
          {result.applied ? (
            <p className="flex items-start gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-emerald-800">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                Přiřazeno <strong>{result.assignedLinks}</strong> odkazů k{" "}
                <strong>{result.targetFindIds?.length ?? 0}</strong> nálezům
                {result.photos && result.photos.some((p) => p.reused)
                  ? " (část fotek se znovupoužila — nic se nekopírovalo)"
                  : ""}
                .
              </span>
            </p>
          ) : needsOverwrite ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
              <p className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>
                  <strong>{collisions.length}</strong>{" "}
                  {collisions.length === 1 ? "slot" : "slotů"} už má sdílenou
                  fotku (např.{" "}
                  {collisions
                    .slice(0, 5)
                    .map((c) => `#${c.findId}${c.slot}`)
                    .join(", ")}
                  {collisions.length > 5 ? " …" : ""}). Přepsat existující
                  odkazy?
                </span>
              </p>
              <button
                type="button"
                onClick={() => submit(true)}
                disabled={isPending}
                className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 font-medium text-white shadow-sm transition hover:bg-amber-700 disabled:opacity-50"
              >
                {isPending && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                )}
                Přepsat a přiřadit
              </button>
            </div>
          ) : null}

          {result.unknownFindIds && result.unknownFindIds.length > 0 && (
            <p className="text-gray-500">
              Neexistující čísla (přeskočena): {result.unknownFindIds.length} —{" "}
              {result.unknownFindIds.slice(0, 10).join(", ")}
              {result.unknownFindIds.length > 10 ? " …" : ""}
            </p>
          )}
          {result.keptOwnFile && result.keptOwnFile.length > 0 && (
            <p className="text-gray-500">
              Nálezy s vlastní foto ponechány beze změny:{" "}
              {result.keptOwnFile.length}.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
