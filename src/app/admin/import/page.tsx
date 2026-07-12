import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ensureAdminAuth } from "@/lib/admin/guard";
import { ImportPanel } from "./import-panel";

export const dynamic = "force-dynamic";

export default async function AdminImportPage() {
  await ensureAdminAuth();

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
        <span className="text-gray-900">Import balíčku</span>
      </div>

      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-gray-900">Import balíčku pro web</h1>
        <p className="text-sm text-gray-500">
          Nahraj jeden <strong>ZIP „balíček pro web“</strong> — originály nálezů,
          výřezy, mapy lokalit a{" "}
          <code className="font-mono">meta/LokaceStavyPoznamky.json</code> —
          najednou. Balíček se nejdřív analyzuje (nic se nezapisuje), ukáže se
          přehled a teprve po tvém potvrzení se soubory nahrají na disk a
          metadata se sloučí. Databázi a náhledy pak vytvoří{" "}
          <Link href="/admin/sync" className="text-brand-700 hover:underline">
            sync
          </Link>
          . Opakovaný import stejného balíčku soubory přepíše (nezduplikuje).
        </p>
      </header>

      <ImportPanel />
    </div>
  );
}
