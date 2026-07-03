"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  CloudUpload,
  Images,
  Loader2,
  Upload,
  X,
  Trash2,
  XCircle,
} from "lucide-react";
import { uploadFindFreePhotos } from "./free-photos-action";
import { moveFreePhoto } from "./free-photos-move-action";
import { deleteFreePhotoInline } from "../free-photos/delete-action";

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

const FREE_PHOTOS_URL_PREFIX = "/generated/find-free-photos";

/** Optimistic mirror of `moveFreePhoto`'s on-disk three-step rename.
 *  Slot letters stay anchored to their positions in the displayed
 *  array; only the URL + filename pair (carrying the file's
 *  extension) swap between the two positions. Filenames have to be
 *  rebuilt because the slot letter is embedded in them.
 *
 *  Cache-busting query param (`?v=${cacheBust}`): when both photos
 *  share an extension (the typical case — server transcodes
 *  everything to .webp on upload) the rebuilt filenames are
 *  STRUCTURALLY IDENTICAL to the originals. React sees no diff in
 *  the `url` field, so the `<img src>` stays the same, and the
 *  browser keeps serving the cached OLD bytes for that URL even
 *  though the server-side rename has flipped the content on disk.
 *  Appending a unique version token to every URL forces the browser
 *  to refetch and reveals the swap. */
function swapAtPositions(
  photos: readonly ExistingEntry[],
  idx: number,
  targetIdx: number,
  findId: number,
  cacheBust: number,
): ExistingEntry[] {
  const a = photos[idx]!;
  const b = photos[targetIdx]!;
  // `\.[^.]+$` grabs the last extension including the dot.
  // Missing extension shouldn't happen — discovery regex requires
  // jpg/jpeg/png/webp — but stays graceful with an empty fallback.
  const aExt = (a.filename.match(/\.[^.]+$/) ?? [""])[0];
  const bExt = (b.filename.match(/\.[^.]+$/) ?? [""])[0];
  const buildName = (slot: string, ext: string): string =>
    `${findId}${slot}_FOTO${ext}`;
  const buildUrl = (filename: string): string =>
    `${FREE_PHOTOS_URL_PREFIX}/${encodeURIComponent(filename)}?v=${cacheBust}`;
  // At position idx (where A used to live): B's content now sits
  // there. New filename uses idx's slot letter + B's original ext.
  const newAtIdx: ExistingEntry = {
    slot: a.slot,
    filename: buildName(a.slot, bExt),
    url: buildUrl(buildName(a.slot, bExt)),
  };
  const newAtTargetIdx: ExistingEntry = {
    slot: b.slot,
    filename: buildName(b.slot, aExt),
    url: buildUrl(buildName(b.slot, aExt)),
  };
  const next = [...photos];
  next[idx] = newAtIdx;
  next[targetIdx] = newAtTargetIdx;
  return next;
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
  const pathname = usePathname();
  const router = useRouter();
  // Local mirror of the gallery list. Two earlier attempts
  // (revalidatePath + router.refresh()) both failed to bring the
  // re-ordered prop down from the server — most likely a combo of PM2
  // cluster cache + browser router cache on a dynamic admin route.
  // Rather than chase the right invalidation chant, we keep the
  // ordering authoritative on the CLIENT during the lifetime of the
  // card.
  //
  // Prop sync rule: re-sync from `existing` ONLY when the SET of
  // slots changes (upload added a slot / delete removed one).
  // Same-set, different-order means it's either our own swap echoing
  // back through router.refresh or — more likely — a stale RSC
  // payload from a sibling PM2 worker. Either way local state is the
  // truthful source and shouldn't be overwritten.
  const [photos, setPhotos] = useState<readonly ExistingEntry[]>(existing);
  useEffect(() => {
    const propSlots = [...existing]
      .map((p) => p.slot)
      .sort((a, b) => a.localeCompare(b))
      .join(",");
    const stateSlots = [...photos]
      .map((p) => p.slot)
      .sort((a, b) => a.localeCompare(b))
      .join(",");
    if (propSlots !== stateSlots) {
      setPhotos(existing);
    }
    // photos intentionally omitted from deps — we only react to the
    // prop, not our own setPhotos calls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing]);
  /** Which (slot, direction) pair is currently in flight. Lets every
   *  button on the row disable itself the moment one of them is
   *  clicked — prevents the operator from queueing two moves and
   *  ending up at an unintended position. */
  const [movingKey, setMovingKey] = useState<string | null>(null);

  const handleMove = (slot: string, direction: "up" | "down") => {
    const idx = photos.findIndex((p) => p.slot === slot);
    if (idx === -1) return;
    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= photos.length) return;
    const key = `${slot}:${direction}`;
    setMovingKey(key);

    // Optimistic local swap — mirrors the server's three-step
    // rename. The slot LETTERS stay where they are (a, b, c order
    // is preserved); the URL + filename pair swap between the two
    // positions. Filenames get rebuilt because they embed the slot
    // letter and the extension of the source file moves with the
    // content. The cacheBust token forces <img> to refetch even
    // when filenames don't change (same-extension case — see
    // swapAtPositions for the gory details).
    const before = photos;
    const cacheBust = Date.now();
    const after = swapAtPositions(photos, idx, targetIdx, findId, cacheBust);
    setPhotos(after);

    const fd = new FormData();
    fd.append("findId", String(findId));
    fd.append("slot", slot);
    fd.append("direction", direction);
    fd.append("currentPath", pathname);
    startTransition(async () => {
      try {
        await moveFreePhoto(fd);
        // Best-effort sync for the rest of the page tree — even
        // though the gallery is now driven by local state, other
        // chunks of the detail page (sibling cards, breadcrumbs,
        // audit summary lines) may still want the fresh data.
        router.refresh();
      } catch (err) {
        // Action threw — revert the optimistic swap. Real failures
        // are rare here (auth gate, missing file race) but worth
        // not lying to the operator about.
        console.error("[free-photos-move] action failed", err);
        setPhotos(before);
      } finally {
        setMovingKey(null);
      }
    });
  };

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
          Volné fotky nálezu ({photos.length})
        </h2>
      </header>

      {photos.length > 0 ? (
        <ul className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {photos.map((p, i) => {
            const isFirst = i === 0;
            const isLast = i === photos.length - 1;
            // Reorder buttons only appear when there's something to
            // reorder — single-photo galleries get no chrome. The
            // first row can't move up; the last can't move down.
            const canReorder = photos.length > 1;
            return (
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
                <div className="flex shrink-0 items-center gap-1">
                  {canReorder && (
                    <>
                      {/* Up/Down buttons drive moveFreePhoto via a
                          controlled handler (not <form action={...}>)
                          so we can call router.refresh() after the
                          action returns — the server-side
                          revalidatePath doesn't reliably reach this
                          dynamic route's client router. movingKey
                          disables every button on the row the moment
                          one is clicked, so a double-click can't queue
                          two moves and end up at a wrong slot. */}
                      <button
                        type="button"
                        onClick={() => handleMove(p.slot, "up")}
                        disabled={isFirst || movingKey !== null}
                        title="Posunout výš"
                        aria-label={`Posunout fotku ${p.slot} výš`}
                        className="rounded border border-gray-300 bg-white p-1 text-gray-700 transition hover:border-gray-400 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
                      >
                        {movingKey === `${p.slot}:up` ? (
                          <Loader2
                            className="h-3 w-3 animate-spin"
                            aria-hidden
                          />
                        ) : (
                          <ArrowUp className="h-3 w-3" aria-hidden />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMove(p.slot, "down")}
                        disabled={isLast || movingKey !== null}
                        title="Posunout níž"
                        aria-label={`Posunout fotku ${p.slot} níž`}
                        className="rounded border border-gray-300 bg-white p-1 text-gray-700 transition hover:border-gray-400 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
                      >
                        {movingKey === `${p.slot}:down` ? (
                          <Loader2
                            className="h-3 w-3 animate-spin"
                            aria-hidden
                          />
                        ) : (
                          <ArrowDown className="h-3 w-3" aria-hidden />
                        )}
                      </button>
                    </>
                  )}
                  {/* Inline delete — `window.confirm` is enough friction
                      for an admin-only workflow; the full two-step
                      pattern lives on the standalone scope's detail
                      page for users who prefer that. Form posts the
                      server action directly so the row goes away on
                      success without a client round-trip. */}
                  <form action={deleteFreePhotoInline}>
                    <input type="hidden" name="name" value={p.filename} />
                    <button
                      type="submit"
                      onClick={(e) => {
                        if (
                          !window.confirm(
                            `Smazat fotku ${p.filename}? Soubor půjde do data/.trash/.`,
                          )
                        ) {
                          e.preventDefault();
                        }
                      }}
                      title="Smazat fotku"
                      aria-label={`Smazat fotku ${p.filename}`}
                      className="rounded border border-red-200 bg-white p-1 text-red-700 transition hover:border-red-300 hover:bg-red-50"
                    >
                      <Trash2 className="h-3 w-3" aria-hidden />
                    </button>
                  </form>
                  <Link
                    href={`/admin/files/free-photos/${encodeURIComponent(p.filename)}`}
                    className="rounded border border-gray-300 bg-white px-2 py-0.5 font-medium text-gray-700 transition hover:border-gray-400 hover:bg-gray-50"
                    title="Otevřít detail fotky"
                  >
                    Detail
                  </Link>
                </div>
              </div>
            </li>
            );
          })}
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
