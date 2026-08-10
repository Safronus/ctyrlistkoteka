"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Open/closed state of an admin section, remembered across reloads.
 *
 * `localStorage` is allowed for exactly this: CLAUDE.md bans client
 * storage for application state, "mimo preferenci UI" — and which panels
 * an operator keeps folded is a UI preference and nothing else. Nothing
 * here is read by the server or affects what is saved.
 *
 * It starts from `defaultOpen` and only then reads the stored value,
 * rather than reading during render. The stored value is per browser, and
 * the server has no idea what it is; initialising from it would render
 * different markup on the two sides and hydration would tear. The cost is
 * one extra render on mount, which is the whole point of the pattern.
 */
export function useRememberedOpen(
  /** Stable per section — `drops.items`, `drops.sheet`, … */
  key: string,
  defaultOpen: boolean,
): [boolean, () => void] {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey(key));
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored === "1" || stored === "0") setOpen(stored === "1");
    } catch {
      // Private mode, storage disabled — the default stands.
    }
  }, [key]);

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(storageKey(key), next ? "1" : "0");
      } catch {
        // Not being able to remember is not a reason to refuse to fold.
      }
      return next;
    });
  }, [key]);

  return [open, toggle];
}

function storageKey(key: string): string {
  return `ctyr.admin.open.${key}`;
}
