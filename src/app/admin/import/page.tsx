import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ensureAdminAuth } from "@/lib/admin/guard";
import { ImportPanel } from "./import-panel";
import { ImportHistory } from "./import-history";
import { readImportHistory } from "@/lib/admin/importHistory";

export const dynamic = "force-dynamic";

export default async function AdminImportPage() {
  await ensureAdminAuth();
  const history = await readImportHistory();

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
          Nahraj jeden <strong>ZIP „balíček pro web“</strong>. Druh se pozná sám
          podle obsahu — nemusíš nic přepínat. Balíček se nejdřív analyzuje (nic
          se nezapisuje), ukáže se přehled a teprve po tvém potvrzení se zapíše.
          Opakovaný import stejného balíčku soubory přepíše (nezduplikuje) a
          nahrazené jdou do koše.
        </p>
        <ul className="space-y-1.5 text-sm text-gray-500">
          <li>
            <strong className="text-gray-700">Balíček 🍀</strong> — originály
            nálezů, výřezy a{" "}
            <code className="font-mono">meta/LokaceStavyPoznamky.json</code>.
            Soubory se připraví na disk; databázi a náhledy pak vytvoří{" "}
            <Link href="/admin/sync" className="text-brand-700 hover:underline">
              sync
            </Link>
            . Mapy sem už nepatří — od v2 chodí vlastním balíčkem níž.
          </li>
          <li>
            <strong className="text-gray-700">Balíček map v2</strong> — nosné
            mapy lokalit a jejich{" "}
            <code className="font-mono">manifest.json</code>. Taky se jen
            připraví pro sync; párování jde přes číslo lokace.
          </li>
          <li>
            <strong className="text-gray-700">
              Balíček reálných fotek lokalit
            </strong>{" "}
            — fotky místa s vyznačenými plochami, kde čtyřlístky rostou, z
            desktopové aplikace. Páruje se <strong>číslem lokace</strong> (
            <code className="font-mono">00126_foto002.png</code> → lokalita
            126). Přehled ukáže po lokalitách, co balíček nese a co u nich už
            na webu je, ať víš, co se přepíše. Fotky se převedou na WebP a
            uloží rovnou — <strong>sync není potřeba</strong>, na stránce
            lokality se ukážou do pěti minut. Lokalita může mít víc fotek;
            zobrazí se jako galerie s popiskem.
          </li>
        </ul>
      </header>

      <ImportPanel />

      <ImportHistory entries={history} />
    </div>
  );
}
