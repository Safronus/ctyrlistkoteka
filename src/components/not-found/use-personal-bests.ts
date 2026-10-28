"use client";

import { useState } from "react";
import {
  BESTS_STORAGE_KEY,
  parseBests,
  recordBest,
  type HuntGame,
  type PersonalBests,
} from "./hunt";

/**
 * The visitor's best round times, kept in THIS browser only (localStorage).
 * Nothing leaves the device — no request, no cookie, no identifier; it's
 * the owner-approved exception to "no app state in browser storage"
 * (CLAUDE.md §3, 2026-10-28). Storage can be missing or throw (private
 * mode, blocked site data): then records just last for the visit.
 */
export function usePersonalBests() {
  const [bests, setBests] = useState<PersonalBests>(() => {
    try {
      return parseBests(window.localStorage.getItem(BESTS_STORAGE_KEY));
    } catch {
      return parseBests(null);
    }
  });

  function record(game: HuntGame, round: number, ms: number) {
    const result = recordBest(bests, game, round, ms);
    if (result.improved) {
      setBests(result.bests);
      try {
        window.localStorage.setItem(BESTS_STORAGE_KEY, JSON.stringify(result.bests));
      } catch {
        // Storage unavailable — the record still shows for this visit.
      }
    }
    return result;
  }

  return { bests, record };
}
