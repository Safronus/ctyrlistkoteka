import { getTranslations } from "next-intl/server";
import type { PublicFind } from "@/lib/queries/finds";
import { FindCard } from "./find-card";

export async function FindGrid({ finds }: { finds: readonly PublicFind[] }) {
  if (finds.length === 0) {
    const t = await getTranslations("Sbirka");
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-12 text-center">
        <p className="text-gray-500">{t("noFindsMatch")}</p>
      </div>
    );
  }

  return (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {finds.map((find) => (
        <li key={find.id}>
          <FindCard find={find} />
        </li>
      ))}
    </ul>
  );
}
