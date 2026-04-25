import { Hourglass } from "lucide-react";
import { FINDS, formatCount } from "@/lib/format";

interface Props {
  count: number;
  minFindId: number | null;
  maxFindId: number | null;
}

/**
 * Renders a soft-amber notice on /sbirka when the find catalog is still
 * being filled in — either because the lowest imported ID is > 1 (older
 * finds not yet uploaded), or because the imported range has gaps. Stays
 * silent when the catalog is contiguous from #1.
 */
export function CollectionProgressBanner({
  count,
  minFindId,
  maxFindId,
}: Props) {
  if (count === 0 || minFindId === null || maxFindId === null) return null;

  const leadingGap = Math.max(0, minFindId - 1);
  const internalGaps = maxFindId - minFindId + 1 - count;
  if (leadingGap === 0 && internalGaps <= 0) return null;

  const fmt = new Intl.NumberFormat("cs-CZ");

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <div className="flex items-start gap-3">
        <Hourglass
          className="mt-0.5 h-5 w-5 shrink-0 text-amber-600"
          aria-hidden
        />
        <div className="space-y-1">
          <p className="font-medium">Sbírka se postupně doplňuje</p>
          <p className="text-amber-800">
            Aktuálně je k dispozici {formatCount(count, FINDS)} (čísla{" "}
            {fmt.format(minFindId)}–{fmt.format(maxFindId)}).{" "}
            {leadingGap > 0 && "Starší nálezy přibývají postupně."}
            {internalGaps > 0 && (
              <>
                {" "}
                V tomto rozsahu zatím chybí {formatCount(internalGaps, FINDS)}.
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
