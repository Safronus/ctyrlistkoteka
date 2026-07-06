import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ensureAdminAuth } from "@/lib/admin/guard";
import { collectNotesToTranslate } from "@/lib/noteTranslations";
import { TranslationsClient } from "./translations-client";

export const dynamic = "force-dynamic";

export default async function TranslationsAdminPage() {
  await ensureAdminAuth();

  // Full set (with current EN) so we can show both the total and how many
  // still lack an EN variant.
  const { finds, maps } = await collectNotesToTranslate({ all: true });
  const findsMissing = finds.filter((f) => !f.en).length;
  const mapsMissing = maps.filter((m) => !m.en).length;

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden />
          Zpět na přehled
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Překlady poznámek</h1>
        <p className="max-w-3xl text-sm text-gray-600">
          Dávkový export/import <strong>anglických</strong> variant poznámek
          nálezů a popisků map. <strong>Stáhni</strong> české zdrojové texty,
          nech je přeložit, a přeložený JSON <strong>nahraj</strong> zpět —
          zapíše se jen <code>en</code> varianta do override vrstvy (
          <code>find-note-overrides.json</code> /{" "}
          <code>map-note-overrides.json</code>), čeština dál sleduje název
          souboru / LSP. Anonymizované a darované nálezy i anonymizované mapy
          se <strong>neexportují</strong> (jejich text se veřejně nezobrazuje).
          Po nahrání se veřejné stránky přegenerují.
        </p>
        <p className="max-w-3xl text-sm text-gray-600">
          Dřív se EN varianta občas jen <strong>zkopírovala z češtiny</strong>{" "}
          bez překladu — proto je tu i <strong>„Stáhnout vše (ke kontrole)“</strong>
          , které zahrne i položky s EN a přiloží u nich současný{" "}
          <code>en</code> k revizi.
        </p>
      </header>

      <TranslationsClient
        findsTotal={finds.length}
        findsMissing={findsMissing}
        mapsTotal={maps.length}
        mapsMissing={mapsMissing}
      />
    </div>
  );
}
