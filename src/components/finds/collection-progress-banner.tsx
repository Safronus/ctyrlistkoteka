"use client";

import { useEffect, useRef, useState } from "react";
import { Hourglass, X } from "lucide-react";
import { FINDS, formatCount } from "@/lib/format";

interface IdRange {
  start: number;
  end: number;
}

interface Props {
  count: number;
  minFindId: number | null;
  maxFindId: number | null;
  /** Internal gap ranges between minFindId and maxFindId. Each entry is
   *  inclusive at both ends; `start === end` means a single missing ID. */
  gaps: readonly IdRange[];
}

const fmt = new Intl.NumberFormat("cs-CZ");

/**
 * Renders a soft-amber notice on /sbirka when the find catalog is still
 * being filled in — either because the lowest imported ID is > 1 (older
 * finds not yet uploaded), or because the imported range has gaps. Stays
 * silent when the catalog is contiguous from #1.
 *
 * When there ARE internal gaps, a "Zobrazit chybějící" button opens a
 * modal listing each missing range as a chip. Uses the native `<dialog>`
 * element — the browser handles focus trap, ESC-to-close, and inert
 * background semantics for free.
 */
export function CollectionProgressBanner({
  count,
  minFindId,
  maxFindId,
  gaps,
}: Props) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  if (count === 0 || minFindId === null || maxFindId === null) return null;

  const leadingGap = Math.max(0, minFindId - 1);
  const internalGaps = maxFindId - minFindId + 1 - count;
  if (leadingGap === 0 && internalGaps <= 0) return null;

  const totalMissingInternal = gaps.reduce(
    (n, g) => n + (g.end - g.start + 1),
    0,
  );

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <div className="flex items-start gap-3">
        <Hourglass
          className="mt-0.5 h-5 w-5 shrink-0 text-amber-600"
          aria-hidden
        />
        <div className="flex-1 space-y-1">
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
          {gaps.length > 0 && (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="mt-1 inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-900 shadow-sm transition hover:border-amber-500 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
            >
              Zobrazit chybějící rozsahy
            </button>
          )}
        </div>
      </div>

      <dialog
        ref={dialogRef}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          // Click on the backdrop (which is the dialog element itself,
          // not its inner content) closes. Children stop propagation
          // implicitly because the click happens on a different target.
          if (e.target === dialogRef.current) setOpen(false);
        }}
        aria-labelledby="missing-finds-title"
        className="w-[min(36rem,calc(100vw-2rem))] rounded-xl border border-gray-200 bg-white p-0 text-amber-900 shadow-xl backdrop:bg-black/40 backdrop:backdrop-blur-sm"
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <h2
            id="missing-finds-title"
            className="text-sm font-semibold text-gray-900"
          >
            Chybějící čísla nálezů
          </h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="-m-1 rounded-md p-1 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
            aria-label="Zavřít"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="space-y-3 px-5 py-4 text-sm">
          <p className="text-gray-700">
            Ve sbírce zatím chybí{" "}
            <strong className="font-semibold text-gray-900">
              {formatCount(totalMissingInternal, FINDS)}
            </strong>{" "}
            v {fmt.format(gaps.length)}{" "}
            {gaps.length === 1
              ? "rozsahu"
              : gaps.length < 5
                ? "rozsazích"
                : "rozsazích"}
            . Postupně přibývají do importu.
          </p>
          <div className="max-h-[55vh] overflow-y-auto">
            <ul className="flex flex-wrap gap-1.5">
              {gaps.map((g) => (
                <li
                  key={`${g.start}-${g.end}`}
                  className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 font-mono text-xs tabular-nums text-amber-900"
                >
                  {g.start === g.end
                    ? fmt.format(g.start)
                    : `${fmt.format(g.start)}–${fmt.format(g.end)}`}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </dialog>
    </div>
  );
}
