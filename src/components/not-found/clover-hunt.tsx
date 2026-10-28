"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";

// Client-only: every round is laid out from a fresh browser-side random
// seed, which a server render could never match. The 404 status, title and
// links are server-rendered around it, so nothing depends on JS but the game.
function Loading() {
  const t = useTranslations("NotFound");
  return <p className="h-72 text-sm text-gray-500 sm:h-96">{t("loading")}</p>;
}
const MeadowGame = dynamic(() => import("./meadow-game").then((m) => m.MeadowGame), {
  ssr: false,
  loading: Loading,
});
const MagnifierGame = dynamic(() => import("./magnifier-game").then((m) => m.MagnifierGame), {
  ssr: false,
  loading: Loading,
});

/** One of the two 404 games, picked per request by the server. */
export function CloverHunt({ game }: { game: "meadow" | "lens" }) {
  return game === "meadow" ? <MeadowGame /> : <MagnifierGame />;
}
