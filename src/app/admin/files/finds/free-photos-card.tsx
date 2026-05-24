"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  CloudUpload,
  Images,
  Loader2,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import { uploadFindFreePhotos } from "./free-photos-action";

interface ExistingEntry {
  slot: string;
  filename: string;
  url: string;
}

interface QueuedFile {
  id: string;
  file: File;
  status: "queued" | "uploading" | "ok" | "rejected";
  reason?: string;
  /** Size on disk after the server's optional conversion (set on ok). */
  size?: number;
  converted?: boolean;
}

interface Props {
  findId: number;
  existing: readonly ExistingEntry[];
}

const ACCEPT = ".jpg,.jpeg,.png,.webp";
const MAX_BYTES = 40 * 1024 * 1024;
const MAX_QUEUE = 20;

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Find-detail card for the "volné fotky nálezu" gallery — extra
 *  snapshots without donation context. Mirrors the donation card but
 *  is simpler: no anonymizovat checkbox (all entries are public), no
 *  EyeOff placeholders, and the dropzone copy explains the server-side
 *  conversion (big inputs become WebP). */
export function FindFreePhotosCard({ findId, existing }: Props) {
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
      if (file.size > MAX_BYTES) {
        additions.push({
          id,
          file,
          status: "rejected",
          reason: `Větší než ${fmtSize(MAX_BYTES)}`,
        });
        continue;
      }
      additions.push({ id, file, status: "queued" });
    }
    setQueue((prev) => {
      const merged = [...prev, ...additions];
      const queuedCount = merged.filter((q) => q.status === "queued").length;
      if (queuedCount > MAX_QUEUE) {
        setBannerError(`Najednou max ${MAX_QUEUE} fotek na nález.`);
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
    setBannerError(null);
    setQueue((prev) =>
      prev.map((q) =>
        q.status === "queued" ? { ...q, status: "uploading" } : q,
      ),
    );
    startTransition(async () => {
      const fd = new FormData();
      fd.append("findId", String(findId));
      for (const q of toUpload) {
        fd.append("files", q.file);
      }
      try {
        const { results } = await uploadFindFreePhotos(fd);
        const byIndex = new Map<number, (typeof results)[number]>();
        for (const r of results) byIndex.set(r.index, r);
        setQueue((prev) => {
          const updated = [...prev];
          toUpload.forEach((q, idx) => {
            const result = byIndex.get(idx);
            const pos = updated.findIndex((x) => x.id === q.id);
            if (pos === -1) return;
            if (!result) {
              updated[pos] = {
                ...updated[pos]!,
                status: "rejected",
                reason: "Server nevrátil výsledek",
              };
              return;
            }
            updated[pos] = {
              ...updated[pos]!,
              status: result.status,
              reason: result.reason,
              size: result.size,
              converted: result.converted,
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
      <header className="mb-3 flex items-center gap-2">
        <Images className="h-4 w-4 text-brand-600" aria-hidden />
        <h2 className="text-sm font-semibold text-gray-900">
          Volné fotky nálezu ({existing.length})
        </h2>
      </header>

      {existing.length > 0 ? (
        <ul className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {existing.map((p) => (
            <li
              key={p.filename}
              className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.url}
                alt={p.filename}
                loading="lazy"
                decoding="async"
                className="aspect-square w-full object-cover"
              />
              <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-[11px]">
                <span className="rounded bg-brand-100 px-1.5 py-0.5 font-mono font-semibold uppercase text-brand-800">
                  {p.slot}
                </span>
                <Link
                  href={`/admin/files/free-photos/${encodeURIComponent(p.filename)}`}
                  className="shrink-0 rounded border border-gray-300 bg-white px-2 py-0.5 font-medium text-gray-700 transition hover:border-gray-400 hover:bg-gray-50"
                  title="Otevřít detail fotky"
                >
                  Detail
                </Link>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-xs text-gray-500">
          Pro tento nález zatím není uložená žádná volná fotka.
        </p>
      )}

      <p className="mb-2 text-xs text-gray-500">
        Nahraj jeden nebo víc snímků (jakkoli pojmenovaných). Server je
        uloží do{" "}
        <code className="font-mono">generated/find-free-photos/</code>{" "}
        jako{" "}
        <code className="break-all font-mono">
          {`${findId}<a|b|c…>_FOTO.<přípona>`}
        </code>{" "}
        — sloty pokračují tam, kde končí stávající fotky. JPEG / PNG /
        WebP, max {fmtSize(MAX_BYTES)}/soubor. Velké snímky (&gt; 2 MB
        nebo &gt; 2400 px na delší straně) server překonvertuje na WebP
        a zmenší na 2400 px.
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
          accept={ACCEPT}
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
                  {q.status === "ok" && q.size !== undefined && q.size !== q.file.size && (
                    <span className="ml-1 text-brand-700">
                      → {fmtSize(q.size)}
                    </span>
                  )}
                </span>
                {q.status === "ok" && q.converted && (
                  <span
                    title="Server překódoval na WebP a/nebo zmenšil rozlišení"
                    className="shrink-0 rounded bg-brand-100 px-1.5 py-0.5 font-medium text-brand-800"
                  >
                    webp
                  </span>
                )}
                {q.status === "rejected" && q.reason && (
                  <span
                    className="shrink-0 max-w-[40%] truncate text-red-700"
                    title={q.reason}
                  >
                    {q.reason}
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

function StatusIcon({ status }: { status: QueuedFile["status"] }) {
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
