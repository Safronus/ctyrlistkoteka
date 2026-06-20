import type { Metadata } from "next";
import { Gift } from "lucide-react";
import { ensureAdminAuth } from "@/lib/admin/guard";
import { getDonatedBoardIds } from "@/lib/donatedBoard.server";
import { DonatedBoardForm } from "./donated-form";

export const metadata: Metadata = {
  title: "Kdo už využil nabídky",
  robots: { index: false, follow: false },
};

// Reads + writes a config file and reflects the live list — never cache.
export const dynamic = "force-dynamic";

export default async function AdminDonatedPage() {
  await ensureAdminAuth();
  const ids = await getDonatedBoardIds();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
          <Gift className="h-5 w-5 text-brand-600" aria-hidden />
          Kdo už využil nabídky
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-600">
          Seznam čísel nálezů, které jsi rozdal na základě nabídky v „Malé
          omluvě na závěr“. Na hlavní stránce se vykreslí jako pole
          čtyřlístků pod omluvou. Přidat lze <strong>jen nález se stavem
          „Darovaný“</strong>. Pořadí na webu je podle čísla. Změny se uloží
          do <code>data/.admin/donated-board.json</code> a projeví se po
          revalidaci (vynucené ihned po uložení).
        </p>
      </header>
      <DonatedBoardForm ids={ids} />
    </div>
  );
}
