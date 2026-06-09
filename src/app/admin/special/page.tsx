import type { Metadata } from "next";
import { Sparkles } from "lucide-react";
import { ensureAdminAuth } from "@/lib/admin/guard";
import { getSpecialFinds } from "@/lib/specialFinds.server";
import { SpecialFindsForm } from "./special-form";

export const metadata: Metadata = {
  title: "Speciální efekty",
  robots: { index: false, follow: false },
};

// Reads + writes a config file and reflects the live list — never cache.
export const dynamic = "force-dynamic";

export default async function AdminSpecialPage() {
  await ensureAdminAuth();
  const items = await getSpecialFinds();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
          <Sparkles className="h-5 w-5 text-brand-600" aria-hidden />
          Speciální efekty nálezů
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-600">
          Přiřaď libovolnému číslu nálezu speciální atmosférický efekt na jeho
          stránce detailu. Efekt <strong>Rekord</strong> navíc dostane vlastní
          zvýrazněnou kartu v „Jubilejních nálezech“, zlatý odznak v seznamu
          sbírky i zlatý bod na mapě — a je <strong>jen jeden</strong>:
          přiřazení rekordu jinému číslu ho z předchozího nálezu automaticky
          odebere (stačí změnit číslo). Změny se uloží do{" "}
          <code>data/.admin/special-finds.json</code> a projeví se po
          revalidaci (vynucené ihned po uložení).
        </p>
      </header>
      <SpecialFindsForm items={items} />
    </div>
  );
}
