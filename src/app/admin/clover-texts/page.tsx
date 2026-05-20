import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ensureAdminAuth } from "@/lib/admin/guard";
import {
  getCloverTexts,
  getCloverTranslations,
} from "@/lib/cloverTextsServer";
import { CloverTextsEditor } from "./editor";

export const dynamic = "force-dynamic";

export default async function CloverTextsAdminPage() {
  await ensureAdminAuth();
  const [texts, translations] = await Promise.all([
    getCloverTexts(),
    getCloverTranslations(),
  ]);

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
        <h1 className="text-2xl font-bold text-gray-900">Textové lístečky</h1>
        <p className="max-w-3xl text-sm text-gray-600">
          Správa rotujících lístečků na hlavní stránce. Edituješ source-of-truth
          v <code>data/meta/clover-texts.json</code> (CZ) a paralelní
          překlady v <code>data/meta/clover-texts.en.json</code>.
          Změny se projeví okamžitě bez rebuildu — runtime loader v{" "}
          <code>src/lib/cloverTexts.ts</code> čte podle mtime.
        </p>
      </header>

      <CloverTextsEditor
        initialTexts={[...texts]}
        initialTranslations={translations}
      />
    </div>
  );
}
