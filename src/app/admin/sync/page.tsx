import Link from "next/link";
import { AlertTriangle, ArrowLeft, Crop, Image as ImageIcon } from "lucide-react";
import { runChecksSummary } from "@/lib/admin/checks";
import { ensureAdminAuth } from "@/lib/admin/guard";
import { getStatus } from "@/lib/admin/syncRunner";
import { SyncPanel } from "./sync-panel";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminSyncPage({ searchParams }: PageProps) {
  await ensureAdminAuth();
  const [status, checks] = await Promise.all([
    getStatus(),
    runChecksSummary(),
  ]);
  const sp = await searchParams;
  const presetRaw = Array.isArray(sp.preset) ? sp.preset[0] : sp.preset;
  const preset =
    presetRaw === "finds" || presetRaw === "maps" || presetRaw === "meta"
      ? presetRaw
      : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 hover:text-gray-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Přehled
        </Link>
        <span aria-hidden>/</span>
        <span className="text-gray-900">Sync</span>
      </div>

      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-gray-900">Sync</h1>
        <p className="text-sm text-gray-500">
          Spustí <code className="font-mono">tsx scripts/sync.ts</code> jako
          podproces. Stdout+stderr se streamují do log souboru pod{" "}
          <code className="font-mono">data/.admin/logs/</code>. Souběžně může
          běžet jen jeden run (stav je sdílený mezi PM2 workery přes disk).
          Před prvním ostrým importem doporučuji{" "}
          <code className="font-mono">--dry-run</code>.
        </p>
      </header>

      {checks.exifIssues > 0 && (
        <ExifPreSyncBanner exifIssues={checks.exifIssues} />
      )}

      <SyncPanel initialStatus={status} initialPreset={preset} />
    </div>
  );
}

/** Pre-sync warning banner. Surfaces the EXIF-missing find count so
 *  the operator notices the issue before kicking off a sync — sync
 *  would land those rows with NULL foundAt, dropping them out of
 *  time-based aggregates on the public site. */
function ExifPreSyncBanner({ exifIssues }: { exifIssues: number }) {
  return (
    <section className="rounded-xl border border-amber-300 bg-amber-50/60 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle
          className="mt-0.5 h-5 w-5 shrink-0 text-amber-600"
          aria-hidden
        />
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <h2 className="text-sm font-semibold text-amber-900">
              {exifIssues} {exifIssues === 1 ? "nález má" : exifIssues < 5 ? "nálezy mají" : "nálezů má"}{" "}
              problém s EXIF datem
            </h2>
            <p className="mt-0.5 text-xs text-amber-900/80">
              Tyto nálezy nemají v DB <code>foundAt</code> a sync je promítne
              jako bez časového zařazení — vypadnou z retrospektivy + většiny
              řad na <code>/statistiky</code>. Doporučuju nejdřív zkontrolovat
              a opravit.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/checks"
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-400 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 shadow-sm hover:bg-amber-50"
            >
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
              Detail v Kontrolách
            </Link>
            <Link
              href="/admin/files/finds?exif_broken=1"
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 shadow-sm hover:bg-amber-50"
            >
              <ImageIcon className="h-3.5 w-3.5" aria-hidden />
              Originály s problémem
            </Link>
            <Link
              href="/admin/files/crops?exif_broken=1"
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 shadow-sm hover:bg-amber-50"
            >
              <Crop className="h-3.5 w-3.5" aria-hidden />
              Ořezy s problémem
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
