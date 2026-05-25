"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import {
  CheckCircle2,
  CloudUpload,
  Loader2,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import {
  MAX_BATCH_BYTES,
  MAX_FILE_BYTES,
  MAX_FILES_PER_REQUEST,
  MAX_QUEUE_FILES,
  type UploadResponse,
  type UploadResult,
} from "./upload-types";

/** Splits queued files into batches that respect both the per-batch
 *  count cap (MAX_FILES_PER_REQUEST) and the total-byte cap
 *  (MAX_BATCH_BYTES). The byte cap is load-bearing: somewhere
 *  upstream of Next.js the request body gets truncated near 10 MB,
 *  so every batch stays below 8 MB. A single oversized file
 *  (>MAX_BATCH_BYTES) ships in its own batch even though it'll
 *  trip the per-file cap on the server — the row comes back
 *  rejected with a clear reason instead of taking the whole batch
 *  with it. */
function splitIntoBatches<T extends { file: File }>(items: T[]): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let currentBytes = 0;
  for (const item of items) {
    const wouldExceedCount = current.length >= MAX_FILES_PER_REQUEST;
    const wouldExceedBytes =
      current.length > 0 && currentBytes + item.file.size > MAX_BATCH_BYTES;
    if (wouldExceedCount || wouldExceedBytes) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(item);
    currentBytes += item.file.size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/** Plain-fetch wrapper. Server actions buffer the whole multipart
 *  body via the RSC encoder and choke on 20+ files × 5 MB; the route
 *  at /admin/api/upload/donation-photos streams via busboy and
 *  handles MAX_FILES_PER_REQUEST batches reliably. */
async function postBatch(formData: FormData): Promise<UploadResponse> {
  const r = await fetch("/admin/api/upload/donation-photos", {
    method: "POST",
    body: formData,
  });
  let body: UploadResponse | null = null;
  try {
    body = (await r.clone().json()) as UploadResponse;
  } catch {
    // Server crashed with a non-JSON response (Next.js HTML 500 page
    // or upstream proxy error). Surface a synthetic UploadResponse so
    // the caller still gets a usable error string in the banner.
    return {
      results: [],
      error: r.ok
        ? "Server vrátil neparsovatelnou odpověď."
        : `HTTP ${r.status}${r.statusText ? " " + r.statusText : ""}`,
    };
  }
  return body;
}

type RowStatus = "queued" | "uploading" | "ok" | "rejected";

interface QueuedFile {
  id: string;
  file: File;
  status: RowStatus;
  reason?: string;
  size?: number;
  findId?: number;
  slot?: string;
  isAnonymized?: boolean;
}

const ACCEPT_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function nameLooksAcceptable(name: string): boolean {
  const lower = name.toLowerCase();
  return ACCEPT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function DonationPhotosUploadForm() {
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((incoming: FileList | File[]) => {
    setBannerError(null);
    const list = Array.from(incoming);
    const additions: QueuedFile[] = [];
    for (const file of list) {
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2);
      if (!nameLooksAcceptable(file.name)) {
        additions.push({
          id,
          file,
          status: "rejected",
          reason: "Povolené přípony jsou jen .jpg / .jpeg / .png / .webp",
        });
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        additions.push({
          id,
          file,
          status: "rejected",
          reason: `Větší než ${fmtSize(MAX_FILE_BYTES)}`,
        });
        continue;
      }
      additions.push({ id, file, status: "queued" });
    }
    setQueue((prev) => {
      const merged = [...prev, ...additions];
      const queuedCount = merged.filter((q) => q.status === "queued").length;
      if (queuedCount > MAX_QUEUE_FILES) {
        setBannerError(
          `Maximum je ${MAX_QUEUE_FILES} souborů ve frontě — část odpoj.`,
        );
      }
      return merged;
    });
  }, []);

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
  };

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!dragActive) setDragActive(true);
  };

  const onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
  };

  const removeFromQueue = (id: string) => {
    setQueue((prev) => prev.filter((q) => q.id !== id));
  };

  const clearAll = () => {
    setQueue([]);
    setBannerError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const onSubmit = () => {
    const toUpload = queue.filter((q) => q.status === "queued");
    if (toUpload.length === 0 || isPending) return;
    if (toUpload.length > MAX_QUEUE_FILES) {
      setBannerError(`Maximum je ${MAX_QUEUE_FILES} souborů ve frontě.`);
      return;
    }
    setBannerError(null);
    // Compute byte-aware batches up front. Loop uses the precomputed
    // structure rather than re-slicing on each iteration so the
    // batch-number reported in errors matches what the user sees.
    const batches = splitIntoBatches(toUpload);
    const firstBatchIds = new Set(batches[0]?.map((q) => q.id) ?? []);
    setQueue((prev) =>
      prev.map((q) =>
        firstBatchIds.has(q.id) ? { ...q, status: "uploading" } : q,
      ),
    );

    startTransition(async () => {
      let aborted = false;

      for (let i = 0; i < batches.length; i++) {
        if (aborted) break;
        const batch = batches[i]!;
        const batchIds = new Set(batch.map((q) => q.id));
        setQueue((prev) =>
          prev.map((q) =>
            batchIds.has(q.id) && q.status === "queued"
              ? { ...q, status: "uploading" }
              : q,
          ),
        );

        const fd = new FormData();
        for (const q of batch) fd.append("files", q.file);

        try {
          const { results, error } = await postBatch(fd);
          // A batch-level error (parse failure, auth, crash) is fatal
          // for the rest of the queue — bail with the banner set so
          // the operator sees what actually broke (no more generic
          // "Server Components render" obscuring the real cause).
          if (error) {
            setBannerError(`Batch ${i + 1}: ${error}`);
            setQueue((prev) =>
              prev.map((q) =>
                q.status === "uploading"
                  ? { ...q, status: "rejected", reason: error }
                  : q,
              ),
            );
            aborted = true;
            break;
          }
          const byBatchIndex = new Map<number, UploadResult>();
          for (const r of results) byBatchIndex.set(r.index, r);

          setQueue((prev) => {
            const updated = [...prev];
            batch.forEach((q, batchIdx) => {
              const result = byBatchIndex.get(batchIdx);
              const idx = updated.findIndex((x) => x.id === q.id);
              if (idx === -1) return;
              if (!result) {
                updated[idx] = {
                  ...updated[idx]!,
                  status: "rejected",
                  reason: "Server nevrátil výsledek",
                };
                return;
              }
              updated[idx] = {
                ...updated[idx]!,
                status: result.status,
                reason: result.reason,
                size: result.size,
                findId: result.findId,
                slot: result.slot,
                isAnonymized: result.isAnonymized,
              };
            });
            return updated;
          });
        } catch (err) {
          // postBatch already maps network errors to UploadResponse.error,
          // so this catch is only reached if `fetch` itself rejected (DNS,
          // CORS, etc.). Treat the same as a fatal batch-level error.
          const reason = err instanceof Error ? err.message : "Upload selhal";
          setBannerError(`Batch ${i + 1}: ${reason}`);
          setQueue((prev) =>
            prev.map((q) =>
              q.status === "uploading"
                ? { ...q, status: "rejected", reason }
                : q,
            ),
          );
          aborted = true;
        }
      }
    });
  };

  const queuedCount = queue.filter((q) => q.status === "queued").length;
  const okCount = queue.filter((q) => q.status === "ok").length;
  const rejectedCount = queue.filter((q) => q.status === "rejected").length;

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900">
          Nahrát reálné fotky darů
        </h2>
        <p className="text-xs text-gray-500">
          {"<id><slot>_DAR[_ANON].<jpg|jpeg|png|webp> • např. "}
          <code className="font-mono">16330a_DAR.jpeg</code> • max{" "}
          {fmtSize(MAX_FILE_BYTES)}/soubor • {MAX_QUEUE_FILES} ve frontě
        </p>
      </header>

      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 transition ${
          dragActive
            ? "border-brand-500 bg-brand-50/50"
            : "border-gray-300 bg-gray-50 hover:border-gray-400"
        } ${isPending ? "pointer-events-none opacity-60" : ""}`}
      >
        <CloudUpload className="h-8 w-8 text-gray-400" aria-hidden />
        <p className="text-sm text-gray-700">
          Přetáhni fotky sem nebo{" "}
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
          accept={ACCEPT_EXTENSIONS.join(",")}
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              addFiles(e.target.files);
              e.target.value = "";
            }
          }}
        />
      </div>

      {bannerError && (
        <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-800">
          {bannerError}
        </p>
      )}

      {queue.length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between text-xs text-gray-600">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>
                Ve frontě: <strong>{queuedCount}</strong>
              </span>
              {okCount > 0 && (
                <span className="text-emerald-700">
                  Hotovo: <strong>{okCount}</strong>
                </span>
              )}
              {rejectedCount > 0 && (
                <span className="text-red-700">
                  Odmítnuto: <strong>{rejectedCount}</strong>
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={clearAll}
                disabled={isPending}
                className="text-xs text-gray-600 hover:text-gray-900 disabled:opacity-50"
              >
                Vyčistit
              </button>
              <button
                type="button"
                onClick={onSubmit}
                disabled={isPending || queuedCount === 0}
                className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Upload className="h-3.5 w-3.5" aria-hidden />
                )}
                Nahrát {queuedCount > 0 ? `(${queuedCount})` : ""}
              </button>
            </div>
          </div>

          <ul className="divide-y divide-gray-200 overflow-hidden rounded-md border border-gray-200">
            {queue.map((q) => (
              <li
                key={q.id}
                className="flex items-center gap-2 px-2.5 py-1.5 text-xs"
              >
                <StatusIcon status={q.status} />
                <span
                  className="min-w-0 flex-1 truncate font-mono text-gray-900"
                  title={q.file.name}
                >
                  {q.file.name}
                </span>
                <span className="shrink-0 font-mono tabular-nums text-gray-500">
                  {fmtSize(q.file.size)}
                </span>
                {q.status === "rejected" && q.reason && (
                  <span
                    className="shrink-0 max-w-[40%] truncate text-red-700"
                    title={q.reason}
                  >
                    {q.reason}
                  </span>
                )}
                {q.status === "ok" && q.findId !== undefined && (
                  <span className="shrink-0 font-mono text-emerald-700">
                    #{q.findId}
                    {q.slot ?? ""}
                    {q.isAnonymized ? " ANON" : ""}
                  </span>
                )}
                {q.status !== "uploading" && (
                  <button
                    type="button"
                    onClick={() => removeFromQueue(q.id)}
                    aria-label="Odebrat z fronty"
                    className="shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function StatusIcon({ status }: { status: RowStatus }) {
  if (status === "uploading") {
    return (
      <Loader2
        className="h-4 w-4 shrink-0 animate-spin text-brand-600"
        aria-hidden
      />
    );
  }
  if (status === "ok") {
    return (
      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
    );
  }
  if (status === "rejected") {
    return <XCircle className="h-4 w-4 shrink-0 text-red-600" aria-hidden />;
  }
  return (
    <CloudUpload className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
  );
}
