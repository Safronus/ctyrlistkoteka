import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { ensureAdminAuth } from "@/lib/admin/guard";
import {
  BANNER_TEXT_KEYS,
  readBannerTextOverrides,
} from "@/lib/bannerTextOverrides";
import { BannerTextsEditor, type BannerRow } from "./editor";

export const dynamic = "force-dynamic";

export default async function BannerTextsAdminPage() {
  await ensureAdminAuth();

  const [tCs, tEn, overrides] = await Promise.all([
    getTranslations({ locale: "cs", namespace: "FindDetail" }),
    getTranslations({ locale: "en", namespace: "FindDetail" }),
    readBannerTextOverrides(),
  ]);

  const rows: BannerRow[] = BANNER_TEXT_KEYS.map((b) => {
    const ov = overrides.get(b.key);
    return {
      key: b.key,
      label: b.label,
      hint: b.hint,
      defaultCs: tCs(b.key),
      defaultEn: tEn(b.key),
      overrideCs: ov?.cs ?? "",
      overrideEn: ov?.en ?? "",
      hasOverride: !!(ov?.cs || ov?.en),
    };
  });

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
        <h1 className="text-2xl font-bold text-gray-900">Texty bannerů</h1>
        <p className="max-w-3xl text-sm text-gray-600">
          Vysvětlující pruhy nad fotkou nálezu (stavy nálezu + odznak rekordu).
          Výchozí texty jsou v překladech aplikace; tady je můžeš{" "}
          <strong>přepsat vlastní verzí</strong> pro češtinu i angličtinu.
          Uloží se do <code>data/.admin/banner-texts.json</code> (přežije rsync
          i re-sync). Prázdné pole nebo „Vrátit na výchozí“ = zpět na překlad
          aplikace. Změny se na webu projeví hned (detaily nálezů se
          přegenerují).
        </p>
      </header>

      <BannerTextsEditor rows={rows} />
    </div>
  );
}
