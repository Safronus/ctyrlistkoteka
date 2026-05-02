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
import { uploadFinds } from "./upload-action";
import {
  MAX_FILE_BYTES,
  MAX_FILES_PER_REQUEST,
  type UploadResult,
} from "./upload-types";

type RowStatus = "queued" | "uploading" | "ok" | "rejected";

interface QueuedFile {
  /** Stable client-side ID so re-renders don't reorder rows. */
  id: string;
  file: File;
  status: RowStatus;
  reason?: string;
  size?: number;
  findId?: number;
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
      if (queuedCount > MAX_FILES_PER_REQUEST) {
        setBannerError(
          `Maximum je ${MAX_FILES_PER_REQUEST} souborů na jeden upload — část odpoj.`,
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

  const onSubmit = () => {
    const toUpload = queue.filter((q) => q.status === "queued");
    if (toUpload.length === 0 || isPending) return;
    if (toUpload.length > MAX_FILES_PER_REQUEST) {
      setBannerError(
        `Maximum je ${MAX_FILES_PER_REQUEST} souborů na jeden upload.`,
      );
      return;
    }
    setBannerError(null);
    setQueue((prev) =>
      prev.map((q) =>
        q.status === "queued" ? { ...q, status: "uploading" } : q,
      ),
    );

    startTransition(async () => {
      const fd = new FormData();
      // Index-bound zipping on the server requires we send `files` in
      // the same order we record them here.
      for (const q of toUpload) fd.append("files", q.file);

      try {
        const { results } = await uploadFinds(fd);
        const byIndex = new Map<number, UploadResult>();
        for (const r of results) byIndex.set(r.index, r);
        setQueue((prev) => {
          const updated = [...prev];
          toUpload.forEach((q, i) => {
            const result = byIndex.get(i);
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
            };
          });
          return updated;
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Upload selhal";
        setBannerError(reason);
        setQueue((prev) =>
          prev.map((q) =>
            q.status === "uploading"
              ? { ...q, status: "rejected", reason }
              : q,
          ),
        );
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
          Nahrát originály nálezů
        </h2>
        <p className="text-xs text-gray-500">
          .jpg / .jpeg • zachovává EXIF • max{" "}
          {fmtSize(MAX_FILE_BYTES)}/soubor • {MAX_FILES_PER_REQUEST}/upload
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
