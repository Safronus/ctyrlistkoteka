"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import {
  Camera,
  CheckSquare,
  FileText,
  Ghost,
  Image as ImageIcon,
  Loader2,
  QrCode,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { FindState } from "@prisma/client";
import { parseFindFilename } from "@/lib/parseFilename";
import { STATE_BADGE, STATE_LABELS } from "@/lib/stateLabels";
import {
  MAX_BULK_DELETE_PER_REQUEST,
  type BulkDeleteResult,
  type BulkRenameResult,
} from "./list-types";

interface ScopeEntry {
  name: string;
  size: number;
  mtime: string;
  isDirectory: boolean;
}

interface Props {
  entries: ScopeEntry[];
  scopeSlug: string;
  /** Server action that trashes the named files and returns per-row
   *  results. Each scope (finds / crops / maps) supplies its own —
   *  the action hard-codes the source root so the caller cannot
   *  cross scopes by tampering with the request. */
  bulkDelete: (formData: FormData) => Promise<{ results: BulkDeleteResult[] }>;
  /** Optional cross-scope coverage set (find IDs in the counterpart
   *  scope). Rows whose leading find ID is NOT in the set get the
   *  missingCoverageLabel badge. ID-based, not name-based, because
   *  finds and crops share only the leading numeric ID — the rest
   *  of the filename can drift. Maps don't supply coverage. */
  coverageFindIds?: Set<number>;
  missingCoverageLabel?: string;
  /** Find IDs that the EXIF consistency check flagged as missing
   *  `foundAt` in the DB. Rows whose leading find ID is in the set
   *  render an amber "EXIF" badge so the operator notices the
   *  problem even without filtering by it. Only set for finds + crops
   *  scopes — other scopes don't have the cross-reference. */
  exifProblemIds?: Set<number>;
  /** Find IDs flagged by the GPS check as missing EXIF coordinates
   *  (and not explicitly NO_GPS). Same UX as exifProblemIds — amber
   *  "GPS" badge per row + drives the ?gps_broken=1 filter. */
  gpsProblemIds?: Set<number>;
  /** NFC-normalised names that carry the "Anonymizovaná lokace" PNG
   *  flag — only set for the maps scope. Rows in this set render an
   *  "anonymizovaná" badge. */
  anonymizedNames?: Set<string>;
  /** Raw row names (no normalisation needed by caller) of maps that
   *  have a real-life photo on disk under
   *  `generated/location-photos/<basename>_reálné foto.*`. Set only
   *  for the maps scope; rows here grow a small camera "foto" badge.
   *  The page builds this by intersecting the per-page entries with
   *  `getRealPhotoMapKeys()` so the props payload stays bounded by
   *  page size. */
  mapsWithRealPhoto?: Set<string>;
  /** Set of find IDs that have at least one donation photo on disk
   *  under `generated/find-photos/<id><slot>_DAR…`. Set on the finds
   *  scope (and matched against the row's leading find ID) so each
   *  row can grow a "foto" badge. Mirrors the maps-scope variant
   *  above. */
  findsWithDonationPhoto?: Set<number>;
  /** When true, rows whose name starts with `NEEXISTUJE-` render a
   *  "zaniklá" badge. Set by the maps scope. */
  showNonexistentBadge?: boolean;
  /** Optional secondary action — currently only the maps scope wires
   *  this to "mark as nonexistent". When set, renders a button next
   *  to bulk-delete with the supplied label.
   *
   *  Server components can't pass arbitrary functions to client
   *  components (only "use server" actions cross that boundary), so
   *  the confirmation copy is a string template with `{n}` for the
   *  selection size — substituted on the client. */
  bulkRename?: {
    /** Button label, e.g. "Označit jako zaniklé". */
    label: string;
    /** Confirmation strip body. `{n}` is replaced with the count of
     *  selected rows, e.g. "Přejmenovat {n} map s prefixem NEEXISTUJE-?". */
    confirmTemplate: string;
    action: (
      formData: FormData,
    ) => Promise<{ results: BulkRenameResult[] }>;
  };
  /** When true, the toolbar renders a "QR ZIP" button alongside
   *  bulk-delete that POSTs the selection to /admin/api/qr-zip and
   *  triggers a single .zip download with one PNG per find. Set only
   *  for the finds scope — other scopes have no QR concept. */
  showQrZip?: boolean;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageName(name: string): boolean {
  return /\.(jpe?g|png|webp|heic|heif|gif)$/i.test(name);
}

function extractFindId(filename: string): number | null {
  const m = /^(\d+)/.exec(filename);
  return m ? Number(m[1]) : null;
}

interface FindNameInfo {
  /** Filename's state token (DAROVANY, BEZGPS, …). NORMAL stays
   *  hidden — it's the default and would just clutter the row. */
  state: FindState | null;
  /** Filename's pole 5 — true when the name carries `+ANO+`. JSON
   *  anonymizace can flip a NE find to anon at sync time, but that
   *  state isn't visible in the filename and would need a server
   *  round-trip to surface here. The badge is "ANO v názvu" only. */
  isAnonymizedInName: boolean;
}

/** Parses a find/crop filename for the listing-row badges. Returns
 *  null when the parser rejects the name — the row will still render,
 *  it just won't grow extra badges. */
function parseFindNameForBadges(filename: string): FindNameInfo | null {
  const r = parseFindFilename(filename);
  if (!r.ok) return null;
  return {
    state: r.value.state,
    isAnonymizedInName: r.value.isAnonymized,
  };
}

interface DuplicateInfo {
  /** Entries that share an NFC-normalised name with at least one
   *  sibling — used to render the "duplikát" badge. */
  flagged: Set<string>;
  /** The subset that the auto-select shortcut would mark for trash:
   *  every entry except the OLDEST in each NFC group. The button
   *  label uses this size so the count matches what gets selected. */
  trashCandidates: Set<string>;
}

function analyzeDuplicates(entries: ScopeEntry[]): DuplicateInfo {
  const groups = new Map<string, ScopeEntry[]>();
  for (const e of entries) {
    const key = e.name.normalize("NFC");
    const arr = groups.get(key) ?? [];
    arr.push(e);
    groups.set(key, arr);
  }
  const flagged = new Set<string>();
  const trashCandidates = new Set<string>();
  for (const [, group] of groups) {
    if (group.length < 2) continue;
    for (const e of group) flagged.add(e.name);
    group.sort((a, b) => Date.parse(a.mtime) - Date.parse(b.mtime));
    for (const e of group.slice(1)) trashCandidates.add(e.name);
  }
  return { flagged, trashCandidates };
}

/** Generic listing with row checkboxes, select-all, NFC-duplicate
 *  detection + auto-select shortcut, optional cross-scope coverage
 *  badge, and a bulk-delete confirmation strip. Used for finds,
 *  crops, and maps; the bulk-delete action is passed in so each
 *  scope keeps its own server-side write boundary. */
export function FilesListClient({
  entries,
  scopeSlug,
  bulkDelete,
  coverageFindIds,
  missingCoverageLabel,
  exifProblemIds,
  gpsProblemIds,
  bulkRename,
  anonymizedNames,
  mapsWithRealPhoto,
  findsWithDonationPhoto,
  showNonexistentBadge,
  showQrZip,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [batchResults, setBatchResults] = useState<BulkDeleteResult[]>([]);
  /** Live progress for chunked bulk delete (>100 files). Drives a tiny
   *  inline "X / N smazáno" indicator while sequential chunks fly. */
  const [deleteProgress, setDeleteProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [renameResults, setRenameResults] = useState<BulkRenameResult[]>([]);
  const [confirming, setConfirming] = useState<"delete" | "rename" | null>(
    null,
  );
  const [qrBusy, setQrBusy] = useState(false);
  const [isPending, startTransition] = useTransition();

  const { flagged, trashCandidates } = useMemo(
    () => analyzeDuplicates(entries),
    [entries],
  );

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const allSelected =
    entries.length > 0 && entries.every((e) => selected.has(e.name));
  const someSelected =
    !allSelected && entries.some((e) => selected.has(e.name));

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(entries.map((e) => e.name)));
  };

  const selectDuplicatesNewest = () => {
    setSelected(new Set(trashCandidates));
  };

  const onConfirmDelete = () => {
    if (selected.size === 0 || isPending) return;
    setBannerError(null);
    setBatchResults([]);
    setDeleteProgress(null);

    startTransition(async () => {
      // Chunk client-side. The server still caps a single request at
      // MAX_BULK_DELETE_PER_REQUEST (protects against accidental
      // Select-All on a 17k-entry listing), but the page size goes up
      // to 500, so a user-visible "smazat všechno" should not bounce
      // off the per-request cap. Splitting into sequential chunks
      // keeps each individual request small while letting the user
      // delete the whole page in one click.
      const names = Array.from(selected);
      const chunks: string[][] = [];
      for (let i = 0; i < names.length; i += MAX_BULK_DELETE_PER_REQUEST) {
        chunks.push(names.slice(i, i + MAX_BULK_DELETE_PER_REQUEST));
      }

      const aggregated: BulkDeleteResult[] = [];
      try {
        for (let i = 0; i < chunks.length; i++) {
          setDeleteProgress({
            done: i * MAX_BULK_DELETE_PER_REQUEST,
            total: names.length,
          });
          const fd = new FormData();
          for (const name of chunks[i]!) fd.append("name", name);
          const { results } = await bulkDelete(fd);
          aggregated.push(...results);
          // Update batch results live so the operator sees the table
          // grow chunk-by-chunk on long deletes (no opaque spinner).
          setBatchResults([...aggregated]);
        }
        setDeleteProgress(null);
        const okNamesNFC = new Set(
          aggregated
            .filter((r) => r.status === "ok")
            .map((r) => r.filename.normalize("NFC")),
        );
        // Drop successfully-trashed entries from selection (NFC-aware
        // so a server response in NFD form still matches a queue
        // entry stored in NFC).
        setSelected((prev) => {
          const next = new Set<string>();
          for (const name of prev) {
            if (!okNamesNFC.has(name.normalize("NFC"))) next.add(name);
          }
          return next;
        });
        setConfirming(null);
      } catch (err) {
        setDeleteProgress(null);
        setBannerError(
          err instanceof Error ? err.message : "Bulk delete selhal",
        );
        setConfirming(null);
      }
    });
  };

  const onDownloadQrZip = async () => {
    if (selected.size === 0 || qrBusy) return;
    setBannerError(null);
    setQrBusy(true);
    try {
      const fd = new FormData();
      for (const name of selected) fd.append("filename", name);
      const r = await fetch("/admin/api/qr-zip", {
        method: "POST",
        body: fd,
      });
      if (!r.ok) {
        // Server returns structured JSON for known errors (oversized
        // batch, no valid names) — surface that message; fall back to
        // a plain HTTP-status report if the body isn't JSON.
        let detail: string;
        try {
          const body = (await r.json()) as { error?: string };
          detail = body.error ?? `HTTP ${r.status}`;
        } catch {
          detail = `HTTP ${r.status}`;
        }
        throw new Error(detail);
      }
      // Stream → Blob → object URL → synthetic anchor click. Cleaner
      // than relying on Content-Disposition alone — works the same
      // across Safari / Chrome / Firefox without sniffing.
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date().toISOString().slice(0, 10);
      a.download = `qr-codes-${stamp}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Give the browser a tick to start the download before the
      // object URL is revoked — premature revoke aborts the save
      // dialog on some Safari versions.
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : "QR ZIP selhal");
    } finally {
      setQrBusy(false);
    }
  };

  const onConfirmRename = () => {
    if (!bulkRename || selected.size === 0 || isPending) return;
    setBannerError(null);
    setRenameResults([]);

    startTransition(async () => {
      const fd = new FormData();
      for (const name of selected) fd.append("name", name);
      try {
        const { results } = await bulkRename.action(fd);
        setRenameResults(results);
        const okNamesNFC = new Set(
          results
            .filter((r) => r.status === "ok")
            .map((r) => r.filename.normalize("NFC")),
        );
        setSelected((prev) => {
          const next = new Set<string>();
          for (const name of prev) {
            if (!okNamesNFC.has(name.normalize("NFC"))) next.add(name);
          }
          return next;
        });
        setConfirming(null);
      } catch (err) {
        setBannerError(
          err instanceof Error ? err.message : "Bulk rename selhal",
        );
        setConfirming(null);
      }
    });
  };

  const dupCount = trashCandidates.size;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={toggleAll}
            className="inline-flex items-center gap-1.5 rounded text-gray-700 hover:text-gray-900"
            aria-label={allSelected ? "Odznačit vše" : "Označit vše"}
          >
            {allSelected ? (
              <CheckSquare className="h-4 w-4 text-brand-600" aria-hidden />
            ) : someSelected ? (
              <CheckSquare
                className="h-4 w-4 text-brand-600 opacity-60"
                aria-hidden
              />
            ) : (
              <Square className="h-4 w-4 text-gray-400" aria-hidden />
            )}
            <span>
              {allSelected
                ? "Odznačit vše"
                : someSelected
                  ? `Vybráno ${selected.size}`
                  : "Označit vše"}
            </span>
          </button>
          {dupCount > 0 && (
            <button
              type="button"
              onClick={selectDuplicatesNewest}
              className="inline-flex items-center gap-1.5 rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-900 hover:bg-amber-100"
              title="Vybere všechny novější kopie u NFC-equivalentních duplikátů (nejstarší zůstane)"
            >
              Vybrat duplikáty ({dupCount})
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && !confirming && showQrZip && (
            <button
              type="button"
              onClick={onDownloadQrZip}
              disabled={isPending || qrBusy}
              title="Vygenerovat PNG QR kódy pro vybrané originály a stáhnout v ZIPu"
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1 font-medium text-gray-700 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 disabled:opacity-50"
            >
              {qrBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <QrCode className="h-3.5 w-3.5" aria-hidden />
              )}
              QR ZIP ({selected.size})
            </button>
          )}
          {selected.size > 0 && !confirming && bulkRename && (
            <button
              type="button"
              onClick={() => setConfirming("rename")}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-white px-2.5 py-1 font-medium text-amber-800 hover:border-amber-300 hover:bg-amber-50 disabled:opacity-50"
            >
              <Ghost className="h-3.5 w-3.5" aria-hidden />
              {bulkRename.label} ({selected.size})
            </button>
          )}
          {selected.size > 0 && !confirming && (
            <button
              type="button"
              onClick={() => setConfirming("delete")}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-white px-2.5 py-1 font-medium text-red-700 hover:border-red-300 hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              Smazat vybrané ({selected.size})
            </button>
          )}
          {confirming === "delete" && (
            <div className="inline-flex items-center gap-2 rounded-md border border-red-300 bg-red-50 px-2.5 py-1">
              <span className="text-red-900">
                Přesunout {selected.size}{" "}
                {selected.size === 1 ? "soubor" : "souborů"} do{" "}
                <code className="font-mono">.trash/</code>?
                {selected.size > MAX_BULK_DELETE_PER_REQUEST && (
                  <span className="ml-1 text-[11px] text-red-800/80">
                    (rozdělí se na{" "}
                    {Math.ceil(selected.size / MAX_BULK_DELETE_PER_REQUEST)}{" "}
                    dávek po {MAX_BULK_DELETE_PER_REQUEST})
                  </span>
                )}
              </span>
              {deleteProgress && (
                <span className="font-mono text-[11px] text-red-800">
                  {deleteProgress.done} / {deleteProgress.total}
                </span>
              )}
              <button
                type="button"
                onClick={onConfirmDelete}
                disabled={isPending}
                className="inline-flex items-center gap-1 rounded bg-red-600 px-2 py-0.5 font-medium text-white hover:bg-red-700 disabled:opacity-60"
              >
                {isPending && (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                )}
                Ano, smazat
              </button>
              <button
                type="button"
                onClick={() => setConfirming(null)}
                disabled={isPending}
                className="rounded border border-gray-300 bg-white px-2 py-0.5 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                Zrušit
              </button>
            </div>
          )}
          {confirming === "rename" && bulkRename && (
            <div className="inline-flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1">
              <span className="text-amber-900">
                {bulkRename.confirmTemplate.replace(
                  "{n}",
                  String(selected.size),
                )}
              </span>
              <button
                type="button"
                onClick={onConfirmRename}
                disabled={isPending}
                className="inline-flex items-center gap-1 rounded bg-amber-600 px-2 py-0.5 font-medium text-white hover:bg-amber-700 disabled:opacity-60"
              >
                {isPending && (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                )}
                Ano, přejmenovat
              </button>
              <button
                type="button"
                onClick={() => setConfirming(null)}
                disabled={isPending}
                className="rounded border border-gray-300 bg-white px-2 py-0.5 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                Zrušit
              </button>
            </div>
          )}
        </div>
      </div>

      {bannerError && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-800">
          {bannerError}
        </p>
      )}

      {batchResults.length > 0 && (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-2 text-xs">
          <p className="mb-1 font-medium text-gray-900">
            Výsledek bulk smazání:{" "}
            <span className="text-emerald-700">
              {batchResults.filter((r) => r.status === "ok").length} ok
            </span>
            {batchResults.some((r) => r.status === "rejected") && (
              <span className="ml-2 text-red-700">
                {batchResults.filter((r) => r.status === "rejected").length}{" "}
                selhalo
              </span>
            )}
            <button
              type="button"
              onClick={() => setBatchResults([])}
              className="float-right text-gray-400 hover:text-gray-600"
              aria-label="Skrýt"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </p>
          {batchResults
            .filter((r) => r.status === "rejected")
            .slice(0, 8)
            .map((r) => (
              <p key={r.filename} className="font-mono text-red-700">
                {r.filename}: {r.reason}
              </p>
            ))}
        </div>
      )}

      {renameResults.length > 0 && (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-2 text-xs">
          <p className="mb-1 font-medium text-gray-900">
            Výsledek bulk přejmenování:{" "}
            <span className="text-emerald-700">
              {renameResults.filter((r) => r.status === "ok").length} ok
            </span>
            {renameResults.some((r) => r.status === "rejected") && (
              <span className="ml-2 text-red-700">
                {renameResults.filter((r) => r.status === "rejected").length}{" "}
                selhalo
              </span>
            )}
            <button
              type="button"
              onClick={() => setRenameResults([])}
              className="float-right text-gray-400 hover:text-gray-600"
              aria-label="Skrýt"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </p>
          {renameResults
            .filter((r) => r.status === "rejected")
            .slice(0, 8)
            .map((r) => (
              <p key={r.filename} className="font-mono text-red-700">
                {r.filename}: {r.reason}
              </p>
            ))}
        </div>
      )}

      <ul className="divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200 bg-white">
        {entries.map((e) => {
          const href = `/admin/files/${scopeSlug}/${encodeURIComponent(e.name)}`;
          const isImg = isImageName(e.name);
          const isSelected = selected.has(e.name);
          const isDup = flagged.has(e.name);
          const findId = extractFindId(e.name);
          const isUncovered =
            coverageFindIds !== undefined &&
            findId !== null &&
            !coverageFindIds.has(findId);
          const isExifBroken =
            exifProblemIds !== undefined &&
            findId !== null &&
            exifProblemIds.has(findId);
          const isGpsBroken =
            gpsProblemIds !== undefined &&
            findId !== null &&
            gpsProblemIds.has(findId);
          return (
            <li
              key={e.name}
              className={`flex items-center gap-3 px-3 py-2 text-sm transition ${
                isSelected ? "bg-brand-50/60" : "hover:bg-gray-50"
              }`}
            >
              <button
                type="button"
                onClick={() => toggle(e.name)}
                className="shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
                aria-label={isSelected ? "Odznačit" : "Označit"}
              >
                {isSelected ? (
                  <CheckSquare
                    className="h-4 w-4 text-brand-600"
                    aria-hidden
                  />
                ) : (
                  <Square className="h-4 w-4" aria-hidden />
                )}
              </button>
              {isImg ? (
                <ImageIcon
                  className="h-4 w-4 shrink-0 text-brand-600"
                  aria-hidden
                />
              ) : (
                <FileText
                  className="h-4 w-4 shrink-0 text-gray-500"
                  aria-hidden
                />
              )}
              <Link
                href={href}
                className="min-w-0 flex-1 truncate font-mono text-xs text-gray-900"
                title={e.name}
              >
                {e.name}
              </Link>
              {isDup && (
                <span
                  className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 font-medium text-[10px] uppercase tracking-wide text-amber-900"
                  title="Existuje další soubor se stejným NFC-normalizovaným názvem (Unicode duplikát)"
                >
                  duplikát
                </span>
              )}
              {isUncovered && missingCoverageLabel && (
                <span
                  className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 font-medium text-[10px] uppercase tracking-wide text-amber-900"
                  title={`Žádný odpovídající soubor v sourozenecké složce (${missingCoverageLabel})`}
                >
                  {missingCoverageLabel}
                </span>
              )}
              {isExifBroken && (
                <span
                  className="shrink-0 rounded bg-amber-200 px-1.5 py-0.5 font-medium text-[10px] uppercase tracking-wide text-amber-900"
                  title="Tento nález nemá v DB EXIF datum (foundAt = null). Sync ho promítne bez časového zařazení — viz /admin/checks."
                >
                  bez EXIF
                </span>
              )}
              {isGpsBroken && (
                <span
                  className="shrink-0 rounded bg-amber-200 px-1.5 py-0.5 font-medium text-[10px] uppercase tracking-wide text-amber-900"
                  title="Tento nález nemá v DB EXIF GPS souřadnice. Chybí na /mapa — viz /admin/checks."
                >
                  bez GPS
                </span>
              )}
              {showNonexistentBadge && e.name.startsWith("NEEXISTUJE-") && (
                <span
                  className="shrink-0 rounded bg-gray-200 px-1.5 py-0.5 font-medium text-[10px] uppercase tracking-wide text-gray-700"
                  title="Mapa označená jako zaniklá (NEEXISTUJE-)"
                >
                  zaniklá
                </span>
              )}
              {anonymizedNames?.has(e.name.normalize("NFC")) && (
                <span
                  className="shrink-0 rounded bg-violet-100 px-1.5 py-0.5 font-medium text-[10px] uppercase tracking-wide text-violet-900"
                  title="Mapa má v PNG metadata Anonymizovaná lokace"
                >
                  anonym.
                </span>
              )}
              {mapsWithRealPhoto?.has(e.name) && (
                <span
                  className="inline-flex shrink-0 items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-[10px] uppercase tracking-wide text-emerald-900"
                  title="Pro tuto mapu existuje reálná fotka v generated/location-photos/"
                >
                  <Camera className="h-3 w-3" aria-hidden />
                  foto
                </span>
              )}
              {findsWithDonationPhoto !== undefined &&
                findId !== null &&
                findsWithDonationPhoto.has(findId) && (
                  <span
                    className="inline-flex shrink-0 items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-[10px] uppercase tracking-wide text-emerald-900"
                    title="Pro tento nález existuje aspoň jedna reálná fotka daru v generated/find-photos/"
                  >
                    <Camera className="h-3 w-3" aria-hidden />
                    foto
                  </span>
                )}
              {(scopeSlug === "finds" || scopeSlug === "crops") &&
                (() => {
                  const info = parseFindNameForBadges(e.name);
                  if (!info) return null;
                  return (
                    <>
                      {info.state !== null &&
                        info.state !== FindState.NORMAL && (
                          <span
                            className={`shrink-0 rounded px-1.5 py-0.5 font-medium text-[10px] uppercase tracking-wide ${STATE_BADGE[info.state]}`}
                            title={`Stav v názvu: ${STATE_LABELS[info.state]}`}
                          >
                            {STATE_LABELS[info.state]}
                          </span>
                        )}
                      {info.isAnonymizedInName && (
                        <span
                          className="shrink-0 rounded bg-purple-100 px-1.5 py-0.5 font-medium text-[10px] uppercase tracking-wide text-purple-800"
                          title="Pole 5 v názvu = ANO (anonymizováno)"
                        >
                          ANO
                        </span>
                      )}
                    </>
                  );
                })()}
              <span className="shrink-0 font-mono text-xs tabular-nums text-gray-500">
                {fmtSize(e.size)}
              </span>
              <span className="hidden shrink-0 font-mono text-xs tabular-nums text-gray-400 sm:inline">
                {new Date(e.mtime).toLocaleDateString("cs-CZ")}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
