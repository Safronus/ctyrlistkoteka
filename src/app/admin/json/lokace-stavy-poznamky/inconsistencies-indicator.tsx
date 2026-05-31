"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { JsonInconsistencies } from "./inconsistencies";
import {
  DuplicatePoznamkyBlock,
  MultipleLocationsBlock,
} from "./inconsistencies-panel";

/**
 * Compact "Kontrola konzistence" chip for the editor header. Green
 * "Konzistentní" pill when the file passes both checks, amber
 * "N nekonzistencí" pill otherwise — click reveals a popover anchored
 * to the chip that lists the offending find IDs (multi-location and
 * duplicate-poznamky) with deep-links to /sbirka.
 *
 * Replaces the previous standalone InconsistenciesPanel section under
 * the editor: the popover keeps the detail accessible without eating
 * page real estate, freeing the column to the right of the editor for
 * the "Hromadný merge" form.
 *
 * Closes on click-outside (mousedown anywhere outside the wrapper) +
 * the Escape key, mirroring the rename popover pattern used by
 * /admin/checks rename actions.
 */
export function InconsistenciesIndicator({
  inconsistencies,
}: {
  inconsistencies: JsonInconsistencies;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const totalCount =
    inconsistencies.multipleLocations.length +
    inconsistencies.duplicatePoznamky.length;
  const isClean = totalCount === 0;

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={
          isClean
            ? "Žádné nekonzistence — data jsou v pořádku"
            : "Klikni pro detail nekonzistencí"
        }
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium transition ${
          isClean
            ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
            : "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"
        }`}
      >
        {isClean ? (
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
        )}
        {isClean ? "Konzistentní" : `${totalCount} nekonzistencí`}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Detail nekonzistencí"
          // Right-anchored to the chip so it stays inside the header
          // even when the indicator sits in the right group near the
          // edge. The min(28rem, ...) cap keeps it readable on mobile.
          className="absolute right-0 top-full z-20 mt-1 w-[min(32rem,calc(100vw-2rem))] space-y-2 rounded-xl border border-gray-200 bg-white p-3 shadow-lg"
        >
          <p className="text-[11px] text-gray-600">
            Hledá situace, které jednotlivé sekce nezachytí samy: jeden
            nález přiřazený k více lokačním mapám a duplicitní klíče v{" "}
            <code className="font-mono">poznamky</code> (JSON.parse je
            tiše sloučí — jedna z poznámek tedy zmizí už při načtení).
          </p>
          <MultipleLocationsBlock
            offenders={inconsistencies.multipleLocations}
          />
          <DuplicatePoznamkyBlock
            offenders={inconsistencies.duplicatePoznamky}
          />
        </div>
      )}
    </div>
  );
}
