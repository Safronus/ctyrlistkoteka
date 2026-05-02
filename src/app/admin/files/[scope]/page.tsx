import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  FileText,
  Image as ImageIcon,
  Search,
} from "lucide-react";
import { ensureAdminAuth } from "@/lib/admin/guard";
import {
  getScope,
  listScope,
  listScopeNamesNFC,
} from "@/lib/admin/scopes";
import { CropsListClient } from "../crops/crops-list-client";
import { CropsUploadForm } from "../crops/upload-form";
import { FindsUploadForm } from "../finds/upload-form";
import { MapsListClient } from "../maps/maps-list-client";
import { MapsUploadForm } from "../maps/upload-form";

/** Allowed `?size=` values. Capped at 500 because each entry incurs
 *  one `fs.stat` call in listScope; on finds (17k+ files) a larger
 *  page would noticeably slow the listing render. For maps (~128
 *  entries) any value at or above 200 effectively shows everything. */
const PAGE_SIZE_OPTIONS = [50, 100, 200, 500] as const;
const DEFAULT_PAGE_SIZE = 100;

function pickPageSize(v: string | undefined): number {
  if (!v) return DEFAULT_PAGE_SIZE;
  const n = Number.parseInt(v, 10);
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(n)
    ? n
    : DEFAULT_PAGE_SIZE;
}

interface PageProps {
  params: Promise<{ scope: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function pickString(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

function pickInt(v: string | undefined, fallback: number): number {
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function isImageName(name: string): boolean {
  return /\.(jpe?g|png|webp|heic|heif|gif)$/i.test(name);
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function AdminScopeListPage({
  params,
  searchParams,
}: PageProps) {
  await ensureAdminAuth();
  const { scope: scopeSlug } = await params;
  const sp = await searchParams;
  const scope = getScope(scopeSlug);
  if (!scope) notFound();

  const query = pickString(sp.q) ?? "";
  const page = pickInt(pickString(sp.page), 1);
  const pageSize = pickPageSize(pickString(sp.size));
  const duplicatesOnly = pickString(sp.dups) === "1";
  const uncoveredOnly = pickString(sp.uncovered) === "1";
  const offset = (page - 1) * pageSize;

  // Cross-scope coverage check: finds ↔ crops share the same
  // filename convention, so the existence of a same-named file in
  // the counterpart scope tells us whether each entry "has its
  // pair". Used both to render a "bez crops" / "bez originálu"
  // badge per row and to drive the ?uncovered=1 filter.
  let counterpartNFC: Set<string> | undefined;
  let counterpartLabel: string | undefined; // badge text
  if (scope.slug === "finds") {
    const cropsScope = getScope("crops");
    if (cropsScope) {
      counterpartNFC = await listScopeNamesNFC(cropsScope);
      counterpartLabel = "bez crops";
    }
  } else if (scope.slug === "crops") {
    const findsScope = getScope("finds");
    if (findsScope) {
      counterpartNFC = await listScopeNamesNFC(findsScope);
      counterpartLabel = "bez originálu";
    }
  }

  const { total, entries } = await listScope(scope, {
    query: query || undefined,
    offset,
    limit: pageSize,
    duplicatesOnly,
    excludeNamesNFC: uncoveredOnly ? counterpartNFC : undefined,
  });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Compute the global uncovered count so the summary line shows
  // "X bez crops" without the user having to flip the filter on.
  // Cheap because we already loaded counterpartNFC; just need this
  // scope's NFC name set, which is a single readdir.
  let uncoveredCount: number | undefined;
  if (counterpartNFC) {
    const ownNFC = await listScopeNamesNFC(scope);
    let n = 0;
    for (const name of ownNFC) {
      if (!counterpartNFC.has(name)) n += 1;
    }
    uncoveredCount = n;
  }

  const buildHref = (
    overrides: Partial<{
      q: string;
      page: number;
      size: number;
      dups: boolean;
      uncovered: boolean;
    }>,
  ) => {
    const merged = {
      q: query,
      page,
      size: pageSize,
      dups: duplicatesOnly,
      uncovered: uncoveredOnly,
      ...overrides,
    };
    const usp = new URLSearchParams();
    if (merged.q) usp.set("q", merged.q);
    if (merged.page > 1) usp.set("page", String(merged.page));
    if (merged.size !== DEFAULT_PAGE_SIZE)
      usp.set("size", String(merged.size));
    if (merged.dups) usp.set("dups", "1");
    if (merged.uncovered) usp.set("uncovered", "1");
    const qs = usp.toString();
    return qs ? `/admin/files/${scope.slug}?${qs}` : `/admin/files/${scope.slug}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link
          href="/admin/files"
          className="inline-flex items-center gap-1 hover:text-gray-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Soubory
        </Link>
        <span aria-hidden>/</span>
        <span className="text-gray-900">{scope.label}</span>
      </div>

      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-gray-900">{scope.label}</h1>
        <p className="text-sm text-gray-500">
          {scope.description} •{" "}
          {total.toLocaleString("cs-CZ")}{" "}
          {total === 1 ? "položka" : total < 5 ? "položky" : "položek"}
          {query ? " v aktuálním filtru" : ""}
          {uncoveredCount !== undefined && uncoveredCount > 0 && (
            <>
              {" • "}
              <span className="text-amber-700">
                {uncoveredCount.toLocaleString("cs-CZ")}{" "}
                {counterpartLabel}
              </span>
            </>
          )}
        </p>
      </header>

      {scope.slug === "finds" && <FindsUploadForm />}
      {scope.slug === "crops" && <CropsUploadForm />}
      {scope.slug === "maps" && <MapsUploadForm />}

      <form
        action={`/admin/files/${scope.slug}`}
        method="get"
        className="flex items-center gap-2"
      >
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
            aria-hidden
          />
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Hledat v názvech…"
            className="block w-full rounded-md border border-gray-300 bg-white py-1.5 pl-9 pr-3 text-sm shadow-sm placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          />
        </div>
        {/* Carry the current page size + duplicates filter through a
            search submit so the user doesn't bounce back to defaults
            every time they refine the filter. */}
        {pageSize !== DEFAULT_PAGE_SIZE && (
          <input type="hidden" name="size" value={String(pageSize)} />
        )}
        {duplicatesOnly && <input type="hidden" name="dups" value="1" />}
        {uncoveredOnly && <input type="hidden" name="uncovered" value="1" />}
        <button
          type="submit"
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700"
        >
          Hledat
        </button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-gray-500">
        <div className="flex flex-wrap items-center gap-2">
          {duplicatesOnly ? (
            <Link
              href={buildHref({ dups: false, page: 1 })}
              className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 font-medium text-amber-900 hover:bg-amber-100"
            >
              <span aria-hidden>×</span>
              Zrušit filtr duplikátů
            </Link>
          ) : (
            <Link
              href={buildHref({ dups: true, page: 1 })}
              className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-0.5 hover:bg-gray-50"
            >
              Filtr: jen duplikáty
            </Link>
          )}
          {counterpartLabel &&
            (uncoveredOnly ? (
              <Link
                href={buildHref({ uncovered: false, page: 1 })}
                className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 font-medium text-amber-900 hover:bg-amber-100"
              >
                <span aria-hidden>×</span>
                Zrušit filtr „{counterpartLabel}&ldquo;
              </Link>
            ) : (
              <Link
                href={buildHref({ uncovered: true, page: 1 })}
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-0.5 hover:bg-gray-50"
              >
                Filtr: jen „{counterpartLabel}&ldquo;
              </Link>
            ))}
        </div>
        {total > PAGE_SIZE_OPTIONS[0] && (
          <div className="flex items-center gap-1">
            <span>Na stránku:</span>
            {PAGE_SIZE_OPTIONS.map((n) => (
              <Link
                key={n}
                href={buildHref({ size: n, page: 1 })}
                className={
                  n === pageSize
                    ? "rounded bg-gray-200 px-1.5 py-0.5 font-semibold text-gray-900"
                    : "rounded px-1.5 py-0.5 hover:bg-gray-100 hover:text-gray-700"
                }
              >
                {n}
              </Link>
            ))}
          </div>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-sm text-gray-500">
          {total === 0 && !query
            ? "Adresář je prázdný (nebo neexistuje)."
            : "Žádný soubor neodpovídá filtru."}
        </div>
      ) : scope.slug === "maps" ? (
        // Maps get the bulk-select listing because the user
        // periodically needs to clean up Unicode-duplicate uploads.
        <MapsListClient entries={entries} scopeSlug={scope.slug} />
      ) : scope.slug === "crops" ? (
        <CropsListClient
          entries={entries}
          scopeSlug={scope.slug}
          coverageNFC={counterpartNFC}
          missingCoverageLabel={counterpartLabel}
        />
      ) : (
        <ul className="divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200 bg-white">
          {entries.map((e) => {
            const href = `/admin/files/${scope.slug}/${encodeURIComponent(e.name)}`;
            const isImg = isImageName(e.name);
            const isUncovered =
              counterpartNFC !== undefined &&
              !counterpartNFC.has(e.name.normalize("NFC"));
            return (
              <li key={e.name}>
                <Link
                  href={href}
                  className="flex items-center gap-3 px-3 py-2 text-sm transition hover:bg-gray-50"
                >
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
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-xs text-gray-900"
                    title={e.name}
                  >
                    {e.name}
                  </span>
                  {isUncovered && counterpartLabel && (
                    <span
                      className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 font-medium text-[10px] uppercase tracking-wide text-amber-900"
                      title={`Žádný odpovídající soubor v sourozenecké složce (${counterpartLabel})`}
                    >
                      {counterpartLabel}
                    </span>
                  )}
                  <span className="shrink-0 font-mono text-xs tabular-nums text-gray-500">
                    {fmtSize(e.size)}
                  </span>
                  <span className="hidden shrink-0 font-mono text-xs tabular-nums text-gray-400 sm:inline">
                    {new Date(e.mtime).toLocaleDateString("cs-CZ")}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <Link
            href={buildHref({ page: Math.max(1, page - 1) })}
            aria-disabled={page <= 1}
            className={`inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 transition hover:bg-gray-50 ${
              page <= 1 ? "pointer-events-none opacity-40" : ""
            }`}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
            Předchozí
          </Link>
          <span>
            Stránka {page} / {totalPages}
          </span>
          <Link
            href={buildHref({ page: Math.min(totalPages, page + 1) })}
            aria-disabled={page >= totalPages}
            className={`inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 transition hover:bg-gray-50 ${
              page >= totalPages ? "pointer-events-none opacity-40" : ""
            }`}
          >
            Další
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      )}
    </div>
  );
}
