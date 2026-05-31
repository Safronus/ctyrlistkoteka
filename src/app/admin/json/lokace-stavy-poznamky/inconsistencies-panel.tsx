"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, MapPin, MessageSquare } from "lucide-react";
import type { JsonInconsistencies } from "./inconsistencies";

/** Read-only panel listing inconsistencies the per-section schemas
 *  can't detect on their own. Two sub-blocks:
 *
 *   1. multipleLocations — find IDs under more than one `lokace.<KEY>`
 *      (a find can only physically belong to a single map). Each row
 *      links to the find detail + lists offending map keys.
 *   2. duplicatePoznamky — find IDs whose key appears more than once
 *      inside the raw `poznamky` block. JSON.parse silently keeps the
 *      last value, so one of the notes was already lost the moment
 *      this file was last saved. Detected by scanning the raw text.
 *
 *  Empty state ("Žádné nekonzistence") is intentional and prominent —
 *  the operator should be able to glance at this section and trust
 *  the data when it's green. */
export function InconsistenciesPanel({
  inconsistencies,
}: {
  inconsistencies: JsonInconsistencies;
}) {
  const { multipleLocations, duplicatePoznamky } = inconsistencies;
  const totalCount = multipleLocations.length + duplicatePoznamky.length;
  const isClean = totalCount === 0;

  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <header className="space-y-1">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-gray-900">
          {isClean ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
          ) : (
            <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden />
          )}
          Kontrola nekonzistencí
          {!isClean && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900">
              {totalCount}
            </span>
          )}
        </h2>
        <p className="text-xs text-gray-600">
          Hledá situace, které jednotlivé sekce nezachytí samy: jeden nález
          přiřazený k více lokačním mapám a duplicitní klíče v{" "}
          <code className="font-mono">poznamky</code> (JSON.parse je tiše
          sloučí na poslední hodnotu — jedna z poznámek tedy zmizí už při
          načtení).
        </p>
      </header>

      {isClean ? (
        <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
          <CheckCircle2
            className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"
            aria-hidden
          />
          <p>Žádné nekonzistence — data jsou v pořádku.</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <MultipleLocationsBlock offenders={multipleLocations} />
          <DuplicatePoznamkyBlock offenders={duplicatePoznamky} />
        </div>
      )}
    </section>
  );
}

export function MultipleLocationsBlock({
  offenders,
}: {
  offenders: JsonInconsistencies["multipleLocations"];
}) {
  if (offenders.length === 0) {
    return (
      <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
        <p className="inline-flex items-center gap-1.5 font-medium text-gray-800">
          <MapPin className="h-3.5 w-3.5" aria-hidden />
          Nález na více lokací
        </p>
        <p className="mt-1">Žádné — každý nález má jen jednu mapu.</p>
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
      <p className="inline-flex items-center gap-1.5 font-medium">
        <MapPin className="h-3.5 w-3.5" aria-hidden />
        Nález na více lokací — {offenders.length}
      </p>
      <p className="text-[11px] text-amber-800/90">
        Tyto ID se objevují pod víc <code className="font-mono">lokace.X</code>{" "}
        klíči. Fyzicky to nedává smysl — nech ID pod jednou mapou a odeber ho
        z ostatních.
      </p>
      <ul className="space-y-1">
        {offenders.map((o) => (
          <li
            key={o.findId}
            className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded border border-amber-300 bg-amber-100/50 px-2 py-1.5"
          >
            <Link
              href={`/sbirka/${o.findId}`}
              className="font-mono font-medium text-amber-900 underline-offset-2 hover:underline"
              prefetch={false}
              target="_blank"
              rel="noreferrer"
            >
              #{o.findId}
            </Link>
            <span className="text-[11px] text-amber-800/90">
              v mapách: {o.mapKeys.map((k) => `"${k}"`).join(", ")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DuplicatePoznamkyBlock({
  offenders,
}: {
  offenders: JsonInconsistencies["duplicatePoznamky"];
}) {
  if (offenders.length === 0) {
    return (
      <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
        <p className="inline-flex items-center gap-1.5 font-medium text-gray-800">
          <MessageSquare className="h-3.5 w-3.5" aria-hidden />
          Duplicitní klíče v poznamky
        </p>
        <p className="mt-1">Žádné — každé ID má v poznámkách jen jeden výskyt.</p>
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
      <p className="inline-flex items-center gap-1.5 font-medium">
        <MessageSquare className="h-3.5 w-3.5" aria-hidden />
        Duplicitní klíče v poznamky — {offenders.length}
      </p>
      <p className="text-[11px] text-amber-800/90">
        Tyto klíče se v raw JSONu opakují. JSON.parse zachová jen poslední
        hodnotu — editor tedy dřív nebo později ztichnutě přepíše jednu z
        verzí. Otevři soubor v editoru a sluč ručně.
      </p>
      <ul className="space-y-1">
        {offenders.map((o) => (
          <li
            key={o.key}
            className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded border border-amber-300 bg-amber-100/50 px-2 py-1.5"
          >
            <Link
              href={`/sbirka/${o.key}`}
              className="font-mono font-medium text-amber-900 underline-offset-2 hover:underline"
              prefetch={false}
              target="_blank"
              rel="noreferrer"
            >
              #{o.key}
            </Link>
            <span className="text-[11px] text-amber-800/90">
              výskytů: <strong>{o.count}×</strong>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
