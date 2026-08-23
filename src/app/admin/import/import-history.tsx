import {
  CheckCircle2,
  CircleSlash,
  FileArchive,
  PackageOpen,
  TriangleAlert,
} from "lucide-react";
import { COLLECTION_TIME_ZONE } from "@/lib/collectionTime";
import type {
  ImportHistoryEntry,
  ImportHistoryOutcome,
  ImportHistoryPackage,
} from "@/lib/admin/importHistory";

/**
 * What has been handed to this page before.
 *
 * Two of the three ways an import ends leave nothing behind on disk — a
 * package reviewed and cancelled, and one that was refused — so without
 * this the only record of them is memory. It answers the question that
 * actually gets asked: did I already send this file, and what did it do.
 *
 * Server-rendered from the log; the panel refreshes the route after every
 * commit or cancel, so it is current without any client fetching.
 */

const fmt = new Intl.DateTimeFormat("cs-CZ", {
  day: "numeric",
  month: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: COLLECTION_TIME_ZONE,
});

const PACKAGE_LABEL: Record<ImportHistoryPackage, string> = {
  v1: "🍀",
  v2: "mapy v2",
  photos: "fotky lokalit",
  unknown: "neznámý",
};

const OUTCOME: Record<
  ImportHistoryOutcome,
  { label: string; cls: string; Icon: typeof CheckCircle2 }
> = {
  committed: {
    label: "nahráno",
    cls: "bg-emerald-100 text-emerald-900",
    Icon: CheckCircle2,
  },
  analyzed: {
    label: "jen zkontrolováno",
    cls: "bg-sky-100 text-sky-900",
    Icon: PackageOpen,
  },
  cancelled: {
    label: "zrušeno",
    cls: "bg-gray-200 text-gray-700",
    Icon: CircleSlash,
  },
  failed: {
    label: "chyba",
    cls: "bg-red-100 text-red-900",
    Icon: TriangleAlert,
  },
};

function fmtBytes(bytes: number): string {
  if (bytes <= 0) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function ImportHistory({ entries }: { entries: ImportHistoryEntry[] }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <header className="mb-2 flex items-center gap-2">
        <FileArchive className="h-4 w-4 text-gray-400" aria-hidden />
        <h2 className="text-sm font-semibold text-gray-900">
          Historie nahrávání
        </h2>
        <span className="text-xs text-gray-400">
          {entries.length > 0
            ? "posledních pár balíčků, včetně zrušených a chybných"
            : "zatím prázdná"}
        </span>
      </header>

      {entries.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-4 text-center text-xs text-gray-500">
          Zaznamenává se od 23. 8. 2026 — starší importy se zpětně dohledat
          nedají, na disku po nich nezůstala stopa.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {entries.map((e, i) => {
            const o = OUTCOME[e.outcome] ?? OUTCOME.failed;
            return (
              <li
                key={`${e.uploadId}-${e.at}-${i}`}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-1.5 text-xs"
              >
                <span className="shrink-0 tabular-nums text-gray-500">
                  {fmtWhen(e.at)}
                </span>
                <span
                  className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${o.cls}`}
                >
                  <o.Icon className="h-3 w-3" aria-hidden />
                  {o.label}
                </span>
                <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                  {PACKAGE_LABEL[e.packageType] ?? e.packageType}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-gray-700" title={e.fileName}>
                  {e.fileName}
                </span>
                <span className="shrink-0 tabular-nums text-gray-400">
                  {fmtBytes(e.bytes)}
                </span>
                {(e.summary || e.error) && (
                  <span
                    className={`w-full ${e.error ? "text-red-800" : "text-gray-500"}`}
                  >
                    {e.error ?? e.summary}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : fmt.format(d);
}
