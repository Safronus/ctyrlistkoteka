"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  CloudUpload,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import { uploadFindDonationPhotos } from "./donation-photos-action";

interface ExistingEntry {
  slot: string;
  filename: string;
  isAnonymized: boolean;
  /** Public URL or null for anonymized entries (Nginx 404s those by
   *  name — the admin still wants to deep-link the file's own detail
   *  page, but can't render a thumbnail). */
  url: string | null;
}

interface QueuedFile {
  id: string;
  file: File;
  anonymize: boolean;
  status: "queued" | "uploading" | "ok" | "rejected";
  reason?: string;
}

interface Props {
  findId: number;
  existing: readonly ExistingEntry[];
  /** Find filename uses `+ANO+` for anonymized = donations from such
   *  finds become anonymized by default in the upload form (the
   *  visitor wouldn't see them on public side anyway). The user can
   *  still flip the checkbox per row. */
  findIsAnonymizedDefault: boolean;
}

const ACCEPT = ".jpg,.jpeg,.png,.webp";
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_QUEUE = 20;

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Find-detail card that mirrors the map-detail real-photo card:
 *  shows existing donation photos for this find + a multi-file
 *  dropzone where each row carries its own "anonymizovat?" checkbox.
 *  The server action assigns slot letters (a, b, c, …) past the last
 *  existing one, so the user only picks files + flags.
 *
 *  Replace path for an existing photo: open its detail page via the
 *  deep link below the thumbnail, delete it there, come back, upload
 *  again. The action doesn't fill gaps, so deleting `b` and then
 *  re-uploading leaves the new photo at the next free letter, not
 *  back at `b` — keeps slot ordering predictable. */
export function FindDonationPhotosCard({
  findId,
  existing,
  findIsAnonymizedDefault,
}: Props) {
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(
    (incoming: FileList | File[]) => {
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
            anonymize: findIsAnonymizedDefault,
            status: "rejected",
            reason: `Větší než ${fmtSize(MAX_BYTES)}`,
          });
          continue;
        }
        additions.push({
          id,
          file,
          // Default the "anonymizovat?" flag from the find's own
          // anonymization state — donating to an anonymized find
          // almost always means the photo is too.
          anonymize: findIsAnonymizedDefault,
          status: "queued",
        });
      }
      setQueue((prev) => {
        const merged = [...prev, ...additions];
        const queuedCount = merged.filter((q) => q.status === "queued").length;
        if (queuedCount > MAX_QUEUE) {
          setBannerError(`Najednou max ${MAX_QUEUE} fotek na nález.`);
        }
        return merged;
      });
    },
    [findIsAnonymizedDefault],
  );

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

  const toggleAnon = (id: string) => {
    setQueue((prev) =>
      prev.map((q) => (q.id === id ? { ...q, anonymize: !q.anonymize } : q)),
    );
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
        fd.append("anon", q.anonymize ? "1" : "0");
      }
      try {
        const { results } = await uploadFindDonationPhotos(fd);
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
        <ImageIcon className="h-4 w-4 text-brand-600" aria-hidden />
        <h2 className="text-sm font-semibold text-gray-900">
          Reálné fotky daru ({existing.length})
        </h2>
      </header>

      {existing.length > 0 ? (
        <ul className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {existing.map((p) => (
            <li
              key={p.filename}
              className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50"
            >
              {p.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.url}
                  alt={p.filename}
                  loading="lazy"
                  decoding="async"
                  className="aspect-square w-full object-cover"
                />
              ) : (
                <div className="flex aspect-square w-full items-center justify-center bg-gray-100 text-gray-400">
                  <EyeOff className="h-8 w-8" aria-hidden />
                </div>
              )}
              <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-[11px]">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="rounded bg-brand-100 px-1.5 py-0.5 font-mono font-semibold uppercase text-brand-800">
                    {p.slot}
                  </span>
                  {p.isAnonymized && (
                    <span
                      title="ANON — Nginx 404s tento soubor; visitor potřebuje unlock kód"
                      className="inline-flex items-center gap-1 rounded bg-violet-100 px-1.5 py-0.5 font-medium text-violet-900"
                    >
                      <EyeOff className="h-3 w-3" aria-hidden />
                      anon
                    </span>
                  )}
                </div>
                <Link
                  href={`/admin/files/donation-photos/${encodeURIComponent(p.filename)}`}
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
          Pro tento nález zatím není uložená žádná reálná fotka daru.
        </p>
      )}

      <p className="mb-2 text-xs text-gray-500">
        Nahraj jeden nebo víc snímků (jakkoli pojmenovaných). Server je
        uloží do <code className="font-mono">generated/find-photos/</code>{" "}
        jako{" "}
        <code className="break-all font-mono">
          {`${findId}<a|b|c…>_DAR[_ANON].<přípona>`}
        </code>{" "}
        — sloty pokračují tam, kde končí stávající fotky. JPEG / PNG /
        WebP, max {fmtSize(MAX_BYTES)}/soubor.
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
                </span>
                {q.status === "queued" && (
                  <label className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-gray-700 hover:border-violet-400 hover:bg-violet-50">
                    <input
                      type="checkbox"
                      checked={q.anonymize}
                      onChange={() => toggleAnon(q.id)}
                      className="h-3 w-3 rounded border-gray-300 text-violet-600 focus:ring-violet-500"
                    />
                    {q.anonymize ? (
                      <EyeOff className="h-3 w-3 text-violet-700" aria-hidden />
                    ) : (
                      <Eye className="h-3 w-3 text-gray-500" aria-hidden />
                    )}
                    <span>anonymizovat</span>
                  </label>
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

      {/* Sync click-through — donation photos themselves bypass sync
       *  (the public site reads them straight from disk on each
       *  render), but the user often wants to re-run sync to pick up
       *  related metadata changes. Preset=finds is the narrowest
       *  sync touching find rows. */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
        <Link
          href="/admin/sync?preset=finds"
          className="inline-flex items-center gap-1.5 rounded-md border border-brand-300 bg-brand-50 px-2.5 py-1.5 text-xs font-medium text-brand-800 transition hover:border-brand-400 hover:bg-brand-100"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Sync s --only=finds
        </Link>
        <span className="text-xs text-gray-500">
          Reálné fotky se nečtou přes sync — cache se invaliduje hned po
          uploadu. Sync je tu pro případ, že měníš i metadata nálezu.
        </span>
      </div>
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
