"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, RotateCcw } from "lucide-react";
import { setBannerTextOverride, type SetBannerTextResult } from "./save-action";

export interface BannerRow {
  key: string;
  label: string;
  hint: string;
  defaultCs: string;
  defaultEn: string;
  /** Current override text, or "" when the banner tracks the default. */
  overrideCs: string;
  overrideEn: string;
  hasOverride: boolean;
}

/**
 * Per-banner editor cards. Each field is pre-filled with the effective text
 * (override if any, else the i18n default) so the admin edits in place. A
 * save that leaves a field on the default value stores nothing — the banner
 * keeps tracking the message catalogue; a genuine edit pins an override in
 * `data/.admin/banner-texts.json`. "Vrátit na výchozí" clears the override.
 */
export function BannerTextsEditor({ rows }: { rows: BannerRow[] }) {
  return (
    <div className="space-y-4">
      {rows.map((r) => (
        <BannerCard key={r.key} row={r} />
      ))}
    </div>
  );
}

function BannerCard({ row }: { row: BannerRow }) {
  const router = useRouter();
  const [cs, setCs] = useState(row.overrideCs || row.defaultCs);
  const [en, setEn] = useState(row.overrideEn || row.defaultEn);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const dirtyFromDefault =
    cs.trim() !== row.defaultCs.trim() || en.trim() !== row.defaultEn.trim();

  const submit = (nextCs: string, nextEn: string) => {
    if (isPending) return;
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const fd = new FormData();
      fd.append("key", row.key);
      fd.append("cs", nextCs);
      fd.append("en", nextEn);
      try {
        const r: SetBannerTextResult = await setBannerTextOverride(fd);
        if (!r.ok) {
          setError(r.error ?? "Uložení selhalo");
          return;
        }
        setSaved(true);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Uložení selhalo");
      }
    });
  };

  const resetToDefault = () => {
    setCs(row.defaultCs);
    setEn(row.defaultEn);
    submit(row.defaultCs, row.defaultEn);
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">{row.label}</h2>
          <p className="text-xs text-gray-500">{row.hint}</p>
        </div>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
            row.hasOverride
              ? "bg-sky-100 text-sky-900"
              : "bg-gray-100 text-gray-500"
          }`}
        >
          {row.hasOverride ? "vlastní" : "výchozí"}
        </span>
      </div>

      <label className="mb-3 block">
        <span className="mb-1 block text-xs font-medium text-gray-700">
          Česky
        </span>
        <textarea
          value={cs}
          onChange={(e) => {
            setCs(e.target.value);
            setSaved(false);
          }}
          rows={2}
          className="w-full rounded border border-gray-300 p-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
        {row.overrideCs && row.overrideCs.trim() !== row.defaultCs.trim() && (
          <span className="mt-1 block text-[11px] text-gray-400">
            Výchozí: {row.defaultCs}
          </span>
        )}
      </label>

      <label className="mb-3 block">
        <span className="mb-1 block text-xs font-medium text-gray-700">
          English
        </span>
        <textarea
          value={en}
          onChange={(e) => {
            setEn(e.target.value);
            setSaved(false);
          }}
          rows={2}
          className="w-full rounded border border-gray-300 p-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
        {row.overrideEn && row.overrideEn.trim() !== row.defaultEn.trim() && (
          <span className="mt-1 block text-[11px] text-gray-400">
            Výchozí: {row.defaultEn}
          </span>
        )}
      </label>

      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {saved && !isPending && (
          <span className="mr-auto inline-flex items-center gap-1 text-xs text-emerald-600">
            <Check className="h-3.5 w-3.5" aria-hidden />
            Uloženo
          </span>
        )}
        <button
          type="button"
          onClick={resetToDefault}
          disabled={isPending || !row.hasOverride}
          className="inline-flex items-center gap-1 rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 transition hover:bg-gray-50 disabled:opacity-40"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          Vrátit na výchozí
        </button>
        <button
          type="button"
          onClick={() => submit(cs, en)}
          disabled={isPending || (!dirtyFromDefault && !row.hasOverride)}
          className="inline-flex items-center gap-1 rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-60"
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Uložit
        </button>
      </div>
    </div>
  );
}
