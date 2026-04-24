import type { FindState } from "@prisma/client";
import { STATE_BADGE, STATE_LABELS } from "@/lib/stateLabels";

export function StateBadges({
  states,
  className,
}: {
  states: readonly FindState[];
  className?: string;
}) {
  if (states.length === 0) return null;
  return (
    <ul className={`flex flex-wrap gap-1 ${className ?? ""}`}>
      {states.map((s) => (
        <li
          key={s}
          className={`rounded-md px-2 py-0.5 text-xs font-medium ${STATE_BADGE[s]}`}
        >
          {STATE_LABELS[s]}
        </li>
      ))}
    </ul>
  );
}
