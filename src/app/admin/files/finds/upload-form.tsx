"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState, useTransition } from "react";
import {
  CheckCircle2,
  CloudUpload,
  Loader2,
  RotateCcw,
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
 *  (MAX_BATCH_BYTES). The byte cap is the load-bearing one — somewhere
 *  upstream of Next.js the request body gets truncated near 10 MB, so
 *  every batch stays below 8 MB to leave headroom for multipart
 *  framing overhead. A single oversized file (>MAX_BATCH_BYTES) ships
 *  in its own batch even though it'll trip the per-file cap on the
 *  server — the row will come back rejected with a clear reason
 *  instead of taking the rest of the batch with it. */
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

/** Posts a multipart batch to the /admin/api/upload/finds REST
 *  endpoint. We use plain fetch instead of a server action because
 *  Next.js's RSC encoder for server actions chokes on ~50-File
 *  batches (request never goes over the wire, error masked as
 *  "Server Components render"). Native multipart upload streams the
 *  body without buffering everything as ArrayBuffer first. */
async function postBatch(formData: FormData): Promise<UploadResponse> {
  const r = await fetch("/admin/api/upload/finds", {
    method: "POST",
    body: formData,
  });
  // Try JSON regardless of status — both 200 and 413/400 carry our
  // structured response shape. If parse fails, fall back to a
  // synthetic error so the form can render something useful.
  let body: UploadResponse | null = null;
  try {
    body = (await r.json()) as UploadResponse;
  } catch {
    /* fall through */
  }
  if (!r.ok && (!body || !body.error)) {
    return { results: [], error: `HTTP ${r.status}` };
  }
  return body ?? { results: [], error: "Prázdná odpověď serveru" };
}

type RowStatus = "queued" | "uploading" | "ok" | "rejected";

interface QueuedFile {
  /** Stable client-side ID so re-renders don't reorder rows. */
  id: string;
  file: File;
  status: RowStatus;
  reason?: string;
  size?: number;
  findId?: number;
  /** Set on status=ok when the server's EXIF inspection flagged a
   *  problem (missing DateTimeOriginal etc.). Rendered inline next
   *  to the row as an amber warning — non-blocking. */
  exifWarning?: string;
}

const ACCEPT_EXTENSIONS = [".jpg", ".jpeg"];

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function nameLooksAcceptable(name: string): boolean {
  const lower = name.toLowerCase();
  return ACCEPT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function FindsUploadForm() {
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const addFiles = useCallback((incoming: FileList | File[]) => {
    setBannerError(null);
    const list = Array.from(incoming);
    const additions: QueuedFile[] = [];
    const filtered: QueuedFile[] = [];
    for (const file of list) {
      // Filter on the client too, but DO NOT skip — show the rejected
      // row so the user understands why the file was excluded.
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2);
      if (!nameLooksAcceptable(file.name)) {
        additions.push({
          id,
          file,
          status: "rejected",
          reason: "Povolené přípony jsou jen .jpg / .jpeg",
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
      filtered.push({ id, file, status: "queued" });
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
    return filtered.length;
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

  /** Resets every rejected row back to "queued" (clearing its reason
   *  + size + findId stamps) so the next onSubmit picks them up. The
   *  underlying File objects stayed in queue all along — re-selecting
   *  from disk is not needed. Useful when the rejection was a
   *  transient batch error (network blip, 413 truncation, post-success
   *  revalidate) rather than a per-file content problem. */
  const retryRejected = () => {
    if (isPending) return;
    setBannerError(null);
    setQueue((prev) =>
      prev.map((q) =>
        q.status === "rejected"
          ? { ...q, status: "queued", reason: undefined }
          : q,
      ),
    );
  };

  const onSubmit = () => {
    const toUpload = queue.filter((q) => q.status === "queued");
    if (toUpload.length === 0 || isPending) return;
    if (toUpload.length > MAX_QUEUE_FILES) {
      setBannerError(
        `Maximum je ${MAX_QUEUE_FILES} souborů ve frontě.`,
      );
      return;
    }
    setBannerError(null);
    // Compute batches up front (count + size capped) so we can mark
    // the first batch as uploading immediately and use stable batch
    // numbers in error messages.
    const batches = splitIntoBatches(toUpload);
    const firstBatchIds = new Set(batches[0]?.map((q) => q.id) ?? []);
    setQueue((prev) =>
      prev.map((q) =>
        firstBatchIds.has(q.id) ? { ...q, status: "uploading" } : q,
      ),
    );

    startTransition(async () => {
      let aborted = false;
      let anyOk = false;

      // Sequential batch submission. Each batch stays under
      // MAX_BATCH_BYTES (8 MB) to dodge the empirical ~10 MB body
      // truncation cap and respects MAX_FILES_PER_REQUEST as a
      // secondary count cap. A transient failure only loses the
      // in-flight batch.
      for (let i = 0; i < batches.length; i += 1) {
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
          const response = await postBatch(fd);
          const { results, error } = response;
          // Top-level `error` means the batch never reached per-file
          // processing — auth, request shape, or post-success
          // revalidate failure. Mark every uploading row as rejected
          // and surface the actual reason in the banner.
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
          if (results.some((r) => r.status === "ok")) anyOk = true;

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
                exifWarning: result.exifWarning,
              };
            });
            return updated;
          });

        } catch (err) {
          // A batch-level failure (network drop, server error) marks
          // every still-uploading row in the queue as rejected. The
          // user can retry by re-dropping the files; we don't auto-
          // retry to keep the failure mode obvious.
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

      // Refresh the surrounding RSC tree so the listing/header counts
      // pick up the new files. Done on the client (instead of via
      // `revalidatePath` inside the action) to keep the action
      // response trivial — the rerendered tree was the previous
      // failure surface for big batches. Run the refresh whenever any
      // row succeeded, even on partial-batch aborts, so the user
      // doesn't lose visibility on what actually landed on disk.
      if (anyOk) router.refresh();
    });
  };

  const queuedCount = queue.filter((q) => q.status === "queued").length;
  const okCount = queue.filter((q) => q.status === "ok").length;
  const rejectedCount = queue.filter((q) => q.status === "rejected").length;

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900">
          Nahrát originály nálezů
        </h2>
        <p className="text-xs text-gray-500">
          .jpg / .jpeg • zachovává EXIF • max{" "}
          {fmtSize(MAX_FILE_BYTES)}/soubor • {MAX_QUEUE_FILES} ve frontě
          (dávky po max {fmtSize(MAX_BATCH_BYTES)} /{" "}
          {MAX_FILES_PER_REQUEST} souborech)
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
        <CloudUpload
          className="h-8 w-8 text-gray-400"
          aria-hidden
        />
        <p className="text-sm text-gray-700">
          Přetáhni JPEGy sem nebo{" "}
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
              // Clear so re-selecting the same file fires onChange again.
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
              {rejectedCount > 0 && (
                <button
                  type="button"
                  onClick={retryRejected}
                  disabled={isPending}
                  className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-medium text-amber-800 shadow-sm transition hover:border-amber-400 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
                  title="Resetuje stav odmítnutých řádků zpět na 'queued' a spustí upload znovu — soubory v queue se nemusí znovu vybírat z disku."
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                  Zkusit znovu ({rejectedCount})
                </button>
              )}
              <button
                type="button"
                onClick={onSubmit}
                disabled={isPending || queuedCount === 0}
                className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPending ? (
                  <Loader2
                    className="h-3.5 w-3.5 animate-spin"
                    aria-hidden
                  />
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
                  </span>
                )}
                {q.status === "ok" && q.exifWarning && (
                  <span
                    className="shrink-0 max-w-[45%] truncate rounded bg-amber-100 px-1.5 py-0.5 font-medium text-[10px] uppercase tracking-wide text-amber-900"
                    title={q.exifWarning}
                  >
                    EXIF: {q.exifWarning}
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
      <CheckCircle2
        className="h-4 w-4 shrink-0 text-emerald-600"
        aria-hidden
      />
    );
  }
  if (status === "rejected") {
    return (
      <XCircle className="h-4 w-4 shrink-0 text-red-600" aria-hidden />
    );
  }
  return (
    <CloudUpload className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
  );
}
