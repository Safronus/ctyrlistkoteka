"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, RefreshCw } from "lucide-react";
import { ImageGallery } from "./image-gallery";
import {
  formatDateCs,
  formatLocationId,
} from "@/lib/format";
import type { RandomFindShowcase } from "@/lib/queries/random-find";

const ROTATION_MS = 60_000;

/**
 * Home-page widget that rotates through random finds. The initial
 * value comes from SSR so the first paint isn't a skeleton; once
 * mounted the widget polls `/api/random-find` every minute, on tab
 * focus, and on manual click of "Další".
 *
 * `ImageGallery` carries the lupa interaction — hover/focus on the
 * magnifier swaps the ORIGINAL photo with the CROP, identical to the
 * find detail page.
 */
export function RandomFindShowcaseWidget({
  initial,
}: {
  initial: RandomFindShowcase | null;
}) {
  const [find, setFind] = useState<RandomFindShowcase | null>(initial);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async (manual = false) => {
    try {
      setRefreshing(true);
      // Manual clicks bypass the browser cache so the user sees a
      // brand-new find immediately. Auto-refreshes ride the
      // `cache-control: max-age=60` we set on the API route, which
      // keeps server load roughly flat regardless of visitor count.
      const res = await fetch("/api/random-find", {
        cache: manual ? "no-store" : "default",
      });
      if (!res.ok) return;
      const data = (await res.json()) as RandomFindShowcase | null;
      if (data) setFind(data);
    } catch {
      /* swallow — keep the previous find on screen */
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const i = setInterval(() => refresh(false), ROTATION_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh(false);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(i);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  if (!find) return null;

  const altBase = find.isAnonymized
    ? `Anonymizovaný nález #${find.id}`
    : `Nález #${find.id}`;
  const foundAtDate = find.foundAt ? new Date(find.foundAt) : null;

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Náhodný nález
        </h2>
        <button
          type="button"
          onClick={() => refresh(true)}
          disabled={refreshing}
          className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-brand-700 transition hover:border-brand-200 hover:shadow-sm disabled:opacity-50"
          aria-label="Zobrazit jiný náhodný nález"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
            aria-hidden
          />
          <span>Další</span>
        </button>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto] sm:items-start">
        <ImageGallery
          image={find.primaryImage}
          cropImage={find.cropImage}
          altBase={altBase}
        />
        <aside className="space-y-2 rounded-xl border border-gray-200 bg-white p-4 sm:w-64">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-gray-900">
              #{find.id}
            </span>
            {foundAtDate && (
              <span className="text-sm text-gray-500">
                {formatDateCs(foundAtDate)}
              </span>
            )}
          </div>
          {find.isAnonymized ? (
            <p className="text-sm text-gray-500">Anonymizovaná lokalita</p>
          ) : find.location ? (
            <p
              className="truncate text-sm text-gray-700"
              title={find.location.code}
            >
              {find.location.code}{" "}
              <span className="font-mono text-xs text-gray-500">
                {formatLocationId(find.location.id)}
              </span>
            </p>
          ) : (
            <p className="text-sm text-gray-500">Bez lokality</p>
          )}
          <Link
            href={`/sbirka/${find.id}`}
            className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
          >
            Detail nálezu
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <p className="pt-1 text-[11px] text-gray-400">
            Mění se každou minutu
          </p>
        </aside>
      </div>
    </section>
  );
}
