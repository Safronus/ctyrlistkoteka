"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import {
  CheckSquare,
  FileText,
  Image as ImageIcon,
  Loader2,
  Square,
  Trash2,
  X,
} from "lucide-react";
import {
  MAX_BULK_DELETE_PER_REQUEST,
  type BulkDeleteResult,
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
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [batchResults, setBatchResults] = useState<BulkDeleteResult[]>([]);
  const [confirming, setConfirming] = useState(false);
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
    if (selected.size > MAX_BULK_DELETE_PER_REQUEST) {
      setBannerError(
        `Maximum je ${MAX_BULK_DELETE_PER_REQUEST} souborů na jeden bulk delete.`,
      );
      return;
    }
    setBannerError(null);
    setBatchResults([]);

    startTransition(async () => {
      const fd = new FormData();
      for (const name of selected) fd.append("name", name);
      try {
        const { results } = await bulkDelete(fd);
        setBatchResults(results);
        const okNamesNFC = new Set(
          results
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
        setConfirming(false);
      } catch (err) {
        setBannerError(
          err instanceof Error ? err.message : "Bulk delete selhal",
        );
        setConfirming(false);
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
          {selected.size > 0 && !confirming && (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-white px-2.5 py-1 font-medium text-red-700 hover:border-red-300 hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              Smazat vybrané ({selected.size})
            </button>
          )}
          {confirming && (
            <div className="inline-flex items-center gap-2 rounded-md border border-red-300 bg-red-50 px-2.5 py-1">
              <span className="text-red-900">
                Přesunout {selected.size}{" "}
                {selected.size === 1 ? "soubor" : "souborů"} do{" "}
                <code className="font-mono">.trash/</code>?
              </span>
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
                onClick={() => setConfirming(false)}
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
