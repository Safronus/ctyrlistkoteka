"use client";

import type { FindState } from "@prisma/client";
import { useTranslations } from "next-intl";
import { STATE_BADGE } from "@/lib/stateLabels";

/**
 * Locale-aware state badge list. Reads labels from next-intl's
 * `States` namespace (cs.json / en.json), falls back to the raw enum
 * key if a translation is missing — better to render `DONATED` than
 * blank when a key drifts. Tailwind tone classes stay locale-agnostic
 * via the static `STATE_BADGE` map.
 *
 * Used inside `NextIntlClientProvider`-wrapped pages only (public
 * surface). Admin pages stick with the raw STATE_LABELS map from
 * `@/lib/stateLabels` since they're locked to Czech.
 */
export function StateBadges({
  states,
  className,
}: {
  states: readonly FindState[];
  className?: string;
}) {
  const t = useTranslations("States");
  if (states.length === 0) return null;
  return (
    <ul className={`flex flex-wrap gap-1 ${className ?? ""}`}>
      {states.map((s) => (
        <li
          key={s}
          className={`rounded-md px-2 py-0.5 text-xs font-medium ${STATE_BADGE[s]}`}
        >
          {t(s)}
        </li>
      ))}
    </ul>
  );
}
