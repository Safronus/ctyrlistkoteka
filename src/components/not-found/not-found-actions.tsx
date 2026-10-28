"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Dices, Home, LayoutGrid, Map as MapIcon } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";

/**
 * Ways out of a 404: home, the collection, the map — and, as the reward for
 * finding the clover, a real four-leaf from the collection. That one asks
 * the site's own public `/api/random-find` (the home page's widget uses it
 * too); nothing about the missing URL is sent anywhere.
 */
export function NotFoundActions({ showRandom }: { showRandom: boolean }) {
  const t = useTranslations("NotFound");
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  async function openRandomFind() {
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch("/api/random-find", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { id?: unknown };
      const id = Number(data.id);
      if (!Number.isInteger(id) || id <= 0) throw new Error("no id");
      router.push(`/sbirka/${id}`);
    } catch {
      setFailed(true);
      setLoading(false);
    }
  }

  const linkCls =
    "inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800";

  return (
    <div className="flex flex-col items-center gap-3">
      {showRandom && (
        <button
          type="button"
          onClick={openRandomFind}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-60"
        >
          <Dices className="h-4 w-4" aria-hidden />
          {loading ? t("randomLoading") : t("randomFind")}
        </button>
      )}
      {failed && (
        <p role="status" className="text-xs text-amber-800">
          {t("randomFailed")}
        </p>
      )}
      <nav aria-label={t("waysOut")} className="flex flex-wrap justify-center gap-2">
        <Link href="/" className={linkCls}>
          <Home className="h-4 w-4" aria-hidden />
          {t("home")}
        </Link>
        <Link href="/sbirka" className={linkCls}>
          <LayoutGrid className="h-4 w-4" aria-hidden />
          {t("collection")}
        </Link>
        <Link href="/mapa" className={linkCls}>
          <MapIcon className="h-4 w-4" aria-hidden />
          {t("map")}
        </Link>
      </nav>
    </div>
  );
}
