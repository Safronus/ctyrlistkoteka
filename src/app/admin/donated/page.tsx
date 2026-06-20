import type { Metadata } from "next";
import { Gift } from "lucide-react";
import { ensureAdminAuth } from "@/lib/admin/guard";
import { DONATED_BOARD_MIN_FIND_ID } from "@/lib/donatedBoard";
import { getDonatedCandidates } from "@/lib/donatedBoard.server";
import { DonatedBoardForm } from "./donated-form";

export const metadata: Metadata = {
  title: "Pole darovaného štěstí",
  robots: { index: false, follow: false },
};

// Reads + writes a config file and reflects the live list — never cache.
export const dynamic = "force-dynamic";

export default async function AdminDonatedPage() {
  await ensureAdminAuth();
  const candidates = await getDonatedCandidates();
  const items = candidates.map((c) => ({
    id: c.id,
    foundAt: c.foundAt ? c.foundAt.toISOString() : null,
    onBoard: c.onBoard,
  }));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
          <Gift className="h-5 w-5 text-brand-600" aria-hidden />
          Pole darovaného štěstí
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-600">
          Přepínačem zapni/vypni, které darované nálezy se mají objevit jako
          pole čtyřlístků pod „Malou omluvou na závěr“ na hlavní stránce.
          Seznam ukazuje jen nálezy se stavem <strong>„Darovaný“</strong> od
          #{DONATED_BOARD_MIN_FIND_ID} výš (starší nemohly být darované přes
          nabídku), nejnovější nahoře. Změny se uloží do{" "}
          <code>data/.admin/donated-board.json</code> a projeví se ihned.
        </p>
      </header>
      <DonatedBoardForm items={items} />
    </div>
  );
}
