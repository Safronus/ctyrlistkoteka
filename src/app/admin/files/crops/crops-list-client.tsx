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
import { deleteCropsBulk } from "./delete-action";
import {
  MAX_BULK_DELETE_PER_REQUEST,
  type BulkDeleteResult,
} from "./delete-types";

interface ScopeEntry {
  name: string;
  size: number;
  mtime: string;
  isDirectory: boolean;
}

interface Props {
  entries: ScopeEntry[];
  scopeSlug: string;
  /** Find-ID set of the counterpart scope (the finds dir, when this
   *  is the crops listing). Rows whose leading find ID is NOT in the
   *  set get the missingCoverageLabel badge. ID-based rather than
   *  name-based because crop and find filenames share only the ID
   *  segment — the rest of the filename (state, anon flag, note
   *  marker) drifts as the user updates metadata. */
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

interface DuplicateInfo {
  /** All entries that share an NFC-normalised name with at least one
   *  sibling — used to render the "duplikát" badge. For 43 dup pairs
   *  this contains 86 names. */
  flagged: Set<string>;
  /** The subset that the auto-select shortcut would mark for trash:
   *  every entry except the OLDEST in each NFC group. For 43 pairs
   *  this contains 43 names. The button label uses this size so the
   *  number matches what actually gets selected. */
  trashCandidates: Set<string>;
}

/** Analyses entries for NFC-equivalent duplicate groups. The return
 *  value separates "files involved in any dup group" (badge) from
 *  "files that would be auto-selected for deletion" (button count) —
 *  conflating the two was the bug where the button said 86 but only
 *  43 rows actually got ticked. */
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
    // Keep the oldest (presumed original from rsync), trash the rest
    // (presumed NFC-collision uploads from the admin form).
    for (const e of group.slice(1)) trashCandidates.add(e.name);
  }
  return { flagged, trashCandidates };
}

function extractFindId(filename: string): number | null {
  // Match leading digit run only — covers both the full
  // `123+...+...+...jpg` form and the short crop-only `123.jpg`
  // form. Mirrors the server-side helper in src/lib/admin/scopes.ts.
  const m = /^(\d+)/.exec(filename);
  return m ? Number(m[1]) : null;
}

export function CropsListClient({
  entries,
  scopeSlug,
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
  const someSelected = !allSelected && entries.some((e) => selected.has(e.name));

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(entries.map((e) => e.name)));
    }
  };

  const selectDuplicatesNewest = () => {
    // Re-use the precomputed trash candidate set rather than walking
    // the entries again — keeps the button count and the actual
    // selection in lockstep.
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
        const { results } = await deleteCropsBulk(fd);
        setBatchResults(results);
        // Drop successfully-deleted entries from selection so a
        // partial failure leaves only the failed ones ticked.
        const okNames = new Set(
          results.filter((r) => r.status === "ok").map((r) => r.filename),
        );
        setSelected((prev) => {
          const next = new Set(prev);
          for (const name of prev) {
            if (okNames.has(name)) next.delete(name);
            // Also normalize via NFC compare in case the server
            // returned a slightly different on-disk form.
            for (const ok of okNames) {
              if (ok.normalize("NFC") === name.normalize("NFC")) {
                next.delete(name);
              }
            }
          }
          return next;
        });
        setConfirming(false);
      } catch (err) {
        setBannerError(err instanceof Error ? err.message : "Bulk delete selhal");
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
              <CheckSquare
                className="h-4 w-4 text-brand-600"
                aria-hidden
              />
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
