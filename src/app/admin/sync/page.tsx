import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ensureAdminAuth } from "@/lib/admin/guard";
import { getStatus } from "@/lib/admin/syncRunner";
import { SyncPanel } from "./sync-panel";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminSyncPage({ searchParams }: PageProps) {
  await ensureAdminAuth();
  const status = await getStatus();
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

      <SyncPanel initialStatus={status} initialPreset={preset} />
    </div>
  );
}
