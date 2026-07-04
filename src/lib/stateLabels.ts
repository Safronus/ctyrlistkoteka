import { FindState } from "@prisma/client";

/**
 * Retired states — no longer assigned by sync and hidden from the public
 * UI. Kept in the enum only so historical data / filename tokens parse;
 * `pnpm sync` sweeps any leftover assignments. See JSON_STATE_MAP.
 */
export const RETIRED_STATES: ReadonlySet<FindState> = new Set([
  FindState.LOCATION_MISSING,
  FindState.LOCATION_GONE,
  FindState.NOT_PICKED,
]);

/** Czech display labels for find states. */
export const STATE_LABELS: Readonly<Record<FindState, string>> = {
  [FindState.NORMAL]: "Běžný",
  [FindState.ANONYMIZED]: "Anonymizovaný",
  [FindState.DONATED]: "Darovaný",
  [FindState.LOST]: "Ztracený",
  [FindState.NO_GPS]: "Bez GPS",
  [FindState.NO_PHOTO]: "Bez fotky",
  [FindState.LOCATION_MISSING]: "Bez lokality",
  [FindState.LOCATION_GONE]: "Zaniklá lokalita",
  [FindState.NOT_PICKED]: "Neutržený",
  [FindState.GIGANT]: "Gigant",
};

/** Tailwind badge class for each state. */
export const STATE_BADGE: Readonly<Record<FindState, string>> = {
  [FindState.NORMAL]: "bg-gray-100 text-gray-700",
  [FindState.ANONYMIZED]: "bg-purple-100 text-purple-700",
  [FindState.DONATED]: "bg-amber-100 text-amber-800",
  [FindState.LOST]: "bg-red-100 text-red-700",
  [FindState.NO_GPS]: "bg-yellow-100 text-yellow-800",
  [FindState.NO_PHOTO]: "bg-slate-100 text-slate-700",
  [FindState.LOCATION_MISSING]: "bg-orange-100 text-orange-700",
  [FindState.LOCATION_GONE]: "bg-rose-100 text-rose-800",
  [FindState.NOT_PICKED]: "bg-blue-100 text-blue-700",
  [FindState.GIGANT]: "bg-emerald-100 text-emerald-800",
};
