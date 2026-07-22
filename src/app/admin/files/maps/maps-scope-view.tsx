import Link from "next/link";
import {
  ArrowLeft,
  Camera,
  EyeOff,
  Ghost,
  ImageOff,
  MapPin,
  Search,
  Users,
} from "lucide-react";
import {
  readMapInventory,
  type MapInventoryEntry,
} from "@/lib/admin/mapsV2";
import {
  getScope,
  getScopeDiskBytes,
  getScopeDiskFreeBytes,
} from "@/lib/admin/scopes";
import { checkSyncNeeded } from "@/lib/admin/syncNeeded";
import { getRealPhotoMapKeys } from "@/lib/locationPhotos";
import { formatAreaM2 } from "@/lib/format";
import { SyncNeededBanner } from "../_shared/sync-needed-banner";

type SP = Record<string, string | string[] | undefined>;

function pickString(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function formatFreeBytes(bytes: number): string {
  const mb = bytes / 1_048_576;
  if (mb >= 1024) {
    return `${new Intl.NumberFormat("cs-CZ", {
      maximumFractionDigits: 1,
    }).format(mb / 1024)} GB`;
  }
  return `${new Intl.NumberFormat("cs-CZ", {
    maximumFractionDigits: 0,
  }).format(mb)} MB`;
}

/** How the map's area is drawn on the web — mirrors the manifest indikátor. */
function indicatorLabel(e: MapInventoryEntry): string {
  if (e.indikator === "polygon") return "polygon";
  if (e.indikator === "radius") {
    return e.radiusM !== null ? `poloměr ${e.radiusM} m` : "poloměr";
  }
  return "bod";
}

/**
 * Manifest-driven listing for the maps scope (v2). Reads
 * `data/maps/manifest.json` — the authoritative inventory — instead of a flat
 * readdir of data/maps/ (which only sees manifest.json + the Nosné/Rendered
 * mapy dirs + stray v1 PNGs). Read-only: v2 maps are added / renamed / retired
 * as a whole through /admin/import, so there's no per-file delete/rename here.
 *
 * The per-map note-override editor + real-photo linkage still key off the v1
 * filename convention and are being adapted in a follow-up; for now the row's
 * "foto" badge is best-effort and the note editor lives on the detail page.
 */
export async function MapsScopeView({ sp }: { sp: SP }) {
  const scope = getScope("maps")!;
  const query = (pickString(sp.q) ?? "").trim();
  const onlyAnon = pickString(sp.anonymized) === "1";
  const onlyCancelled = pickString(sp.nonexistent) === "1";

  const [inventory, diskBytes, diskFreeBytes, photoKeys] = await Promise.all([
    readMapInventory(),
    getScopeDiskBytes(scope),
    getScopeDiskFreeBytes(scope),
    getRealPhotoMapKeys(),
  ]);

  const crumbs = (
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
  );

  // No manifest → pre-v2 / not-yet-imported data dir. Point the operator at
  // the import flow rather than silently showing an empty list.
  if (inventory === null) {
    return (
      <div className="space-y-4">
        {crumbs}
        <h1 className="text-2xl font-bold text-gray-900">{scope.label}</h1>
        <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
          V <code className="font-mono">data/maps/</code> není žádný{" "}
          <code className="font-mono">manifest.json</code> — mapy verze 2 zatím
          nebyly naimportovány. Nahraj balíček map přes{" "}
          <Link href="/admin/import" className="font-medium underline">
            /admin/import
          </Link>
          .
        </div>
      </div>
    );
  }

  const total = inventory.length;
  const anonCount = inventory.filter((e) => e.anonymized).length;
  const cancelledCount = inventory.filter((e) => e.cancelled).length;
  const missingCount = inventory.filter((e) => e.fileMissing).length;

  const q = query.toLowerCase();
  let rows = inventory;
  if (q) {
    rows = rows.filter(
      (e) =>
        String(e.cislo).includes(q) ||
        e.code.toLowerCase().includes(q) ||
        e.displayName.toLowerCase().includes(q) ||
        e.mesto.toLowerCase().includes(q) ||
        e.stat.toLowerCase().includes(q),
    );
  }
  if (onlyAnon) rows = rows.filter((e) => e.anonymized);
  if (onlyCancelled) rows = rows.filter((e) => e.cancelled);

  const buildHref = (
    overrides: Partial<{ q: string; anonymized: boolean; cancelled: boolean }>,
  ) => {
    const merged = {
      q: query,
      anonymized: onlyAnon,
      cancelled: onlyCancelled,
      ...overrides,
    };
    const usp = new URLSearchParams();
    if (merged.q) usp.set("q", merged.q);
    if (merged.anonymized) usp.set("anonymized", "1");
    if (merged.cancelled) usp.set("nonexistent", "1");
    const qs = usp.toString();
    return qs ? `/admin/files/maps?${qs}` : "/admin/files/maps";
  };

  const syncBanner = await checkSyncNeeded(["maps"]);

  return (
    <div className="space-y-4">
      {crumbs}

      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-gray-900">{scope.label}</h1>
        <p className="text-sm text-gray-500">
          Mapy verze 2 z <code className="font-mono">manifest.json</code> ·{" "}
          {total.toLocaleString("cs-CZ")}{" "}
          {total === 1 ? "mapa" : total < 5 ? "mapy" : "map"}
          {query ? " v aktuálním filtru" : ""}
          {" • "}
          <span className="font-medium text-gray-700">
            {new Intl.NumberFormat("cs-CZ", {
              maximumFractionDigits: 1,
            }).format(diskBytes / 1_048_576)}{" "}
            MB
          </span>{" "}
          na disku
          {diskFreeBytes !== null && (
            <>
              {" • zbývá "}
              <span className="font-medium text-gray-700">
                {formatFreeBytes(diskFreeBytes)}
              </span>{" "}
              volných
            </>
          )}
        </p>
      </header>

      <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-600">
        Mapy verze 2 se přidávají, přejmenovávají i ruší jako celek přes{" "}
        <Link href="/admin/import" className="font-medium underline">
          /admin/import
        </Link>{" "}
        (ZIP balíček). Tady je jen přehled — jednotlivé soubory se odsud nemažou
        ani nepřejmenovávají.
      </div>

      <SyncNeededBanner result={syncBanner} preset="maps" label={scope.label} />

      {missingCount > 0 && (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-800">
          {missingCount.toLocaleString("cs-CZ")}{" "}
          {missingCount === 1 ? "mapa v manifestu nemá" : "map v manifestu nemá"}{" "}
          nosný PNG na disku — balíček je nekompletní. Doimportuj přes
          /admin/import.
        </p>
      )}

      <form
        action="/admin/files/maps"
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
            placeholder="Hledat: číslo, kód, název, město…"
            className="block w-full rounded-md border border-gray-300 bg-white py-1.5 pl-9 pr-3 text-sm shadow-sm placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          />
        </div>
        {onlyAnon && <input type="hidden" name="anonymized" value="1" />}
        {onlyCancelled && <input type="hidden" name="nonexistent" value="1" />}
        <button
          type="submit"
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700"
        >
          Hledat
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
        {anonCount > 0 &&
          (onlyAnon ? (
            <Link
              href={buildHref({ anonymized: false })}
              className="inline-flex items-center gap-1 rounded-md border border-violet-300 bg-violet-50 px-2 py-0.5 font-medium text-violet-900 hover:bg-violet-100"
            >
              <span aria-hidden>×</span>
              Zrušit „jen anonymizované&ldquo;
            </Link>
          ) : (
            <Link
              href={buildHref({ anonymized: true })}
              className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-0.5 hover:bg-gray-50"
            >
              Filtr: jen anonymizované ({anonCount})
            </Link>
          ))}
        {cancelledCount > 0 &&
          (onlyCancelled ? (
            <Link
              href={buildHref({ cancelled: false })}
              className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 font-medium text-amber-900 hover:bg-amber-100"
            >
              <span aria-hidden>×</span>
              Zrušit „jen zaniklé&ldquo;
            </Link>
          ) : (
            <Link
              href={buildHref({ cancelled: true })}
              className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-0.5 hover:bg-gray-50"
            >
              Filtr: jen zaniklé ({cancelledCount})
            </Link>
          ))}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-sm text-gray-500">
          {total === 0
            ? "Manifest neobsahuje žádné mapy."
            : "Žádná mapa neodpovídá filtru."}
        </div>
      ) : (
        <ul className="divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200 bg-white">
          {rows.map((e) => {
            const href = `/admin/files/maps/${encodeURIComponent(e.nosnaName)}`;
            const hasPhoto = photoKeys.has(
              e.nosnaName
                .slice(0, e.nosnaName.length - ".png".length)
                .normalize("NFC")
                .toLowerCase(),
            );
            return (
              <li
                key={e.cislo}
                className="flex items-center gap-3 px-3 py-2 text-sm transition hover:bg-gray-50"
              >
                <MapPin
                  className="h-4 w-4 shrink-0 text-brand-600"
                  aria-hidden
                />
                <span className="w-14 shrink-0 font-mono text-xs tabular-nums text-gray-500">
                  {String(e.cislo).padStart(5, "0")}
                </span>
                <Link href={href} className="min-w-0 flex-1">
                  <span
                    className="block truncate font-mono text-xs text-gray-900"
                    title={e.code}
                  >
                    {e.code}
                  </span>
                  <span className="block truncate text-[11px] text-gray-500">
                    {e.displayName !== e.code && `${e.displayName} · `}
                    {e.mesto}, {e.stat} · {indicatorLabel(e)}
                    {e.areaM2 !== null && ` · ${formatAreaM2(e.areaM2)}`}
                  </span>
                </Link>
                {e.isChild && (
                  <span
                    className="inline-flex shrink-0 items-center gap-1 rounded bg-sky-100 px-1.5 py-0.5 font-medium text-[10px] uppercase tracking-wide text-sky-900"
                    title="Podřízená lokalita (potomek)"
                  >
                    <Users className="h-3 w-3" aria-hidden />
                    potomek
                  </span>
                )}
                {e.cancelled && (
                  <span
                    className="inline-flex shrink-0 items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 font-medium text-[10px] uppercase tracking-wide text-amber-900"
                    title="Zaniklá lokalita (manifest: zrušena)"
                  >
                    <Ghost className="h-3 w-3" aria-hidden />
                    zaniklá
                  </span>
                )}
                {e.anonymized && (
                  <span
                    className="inline-flex shrink-0 items-center gap-1 rounded bg-violet-100 px-1.5 py-0.5 font-medium text-[10px] uppercase tracking-wide text-violet-900"
                    title="Anonymizovaná lokalita (manifest)"
                  >
                    <EyeOff className="h-3 w-3" aria-hidden />
                    anonym.
                  </span>
                )}
                {hasPhoto && (
                  <span
                    className="inline-flex shrink-0 items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-[10px] uppercase tracking-wide text-emerald-900"
                    title="Pro tuto mapu existuje reálná fotka v generated/location-photos/"
                  >
                    <Camera className="h-3 w-3" aria-hidden />
                    foto
                  </span>
                )}
                {e.fileMissing && (
                  <span
                    className="inline-flex shrink-0 items-center gap-1 rounded bg-rose-100 px-1.5 py-0.5 font-medium text-[10px] uppercase tracking-wide text-rose-900"
                    title="Nosný PNG chybí na disku"
                  >
                    <ImageOff className="h-3 w-3" aria-hidden />
                    chybí PNG
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
