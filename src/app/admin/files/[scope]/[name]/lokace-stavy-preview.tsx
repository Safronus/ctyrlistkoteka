"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Search } from "lucide-react";
import type { LSPAnalysis } from "@/lib/admin/lokaceStavyAnalysis";
import type { SectionKey } from "@/lib/admin/jsonSchema";
import { JsonSectionsPreview } from "./json-sections-preview";

interface Props {
  sections: { key: SectionKey; label: string; content: string }[];
  analysis: LSPAnalysis;
  poznamky: Record<string, string>;
}

/** Combined preview for LokaceStavyPoznamky.json: stats banner with
 *  anomaly badges, a find-ID lookup widget that reads the analysis's
 *  reverse maps, and the existing tabbed JSON preview underneath. */
export function LokaceStavyPoznamkyPreview({
  sections,
  analysis,
  poznamky,
}: Props) {
  return (
    <div className="space-y-3">
      <StatsBanner analysis={analysis} />
      <FindLookup analysis={analysis} poznamky={poznamky} />
      <JsonSectionsPreview sections={sections} />
    </div>
  );
}

function StatsBanner({ analysis }: { analysis: LSPAnalysis }) {
  const stavyKeys = Object.keys(analysis.findsInStavy).sort((a, b) =>
    a.localeCompare(b),
  );
  const hasAnomaly =
    analysis.donanyMissingNoteTotal > 0 ||
    analysis.stavyMissingLokaceTotal > 0;

  return (
    <section className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Lokalizováno (find IDs)" value={analysis.findsInLokace} />
        <Stat label="Ve stavu (find IDs)" value={analysis.findsInAnyStavy} />
        <Stat label="Poznámek" value={analysis.notesCount} />
        <Stat label="Anonymizováno" value={analysis.anonymizovaneCount} />
      </div>

      <details className="rounded-lg border border-gray-200 bg-white p-3 text-xs">
        <summary className="cursor-pointer font-medium text-gray-900">
          Stavy podle klíče
        </summary>
        <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
          {stavyKeys.map((k) => (
            <li
              key={k}
              className="flex items-baseline justify-between gap-2 font-mono"
            >
              <span className="text-gray-700">{k}</span>
              <span className="tabular-nums text-gray-500">
                {analysis.findsInStavy[k]?.toLocaleString("cs-CZ")}
              </span>
            </li>
          ))}
        </ul>
      </details>

      {hasAnomaly ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="mb-2 inline-flex items-center gap-1.5 font-medium">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            Detekované nesrovnalosti
          </p>
          {analysis.donanyMissingNoteTotal > 0 && (
            <AnomalyRow
              title={`DAROVANÝ bez poznámky (${analysis.donanyMissingNoteTotal})`}
              ids={analysis.donanyMissingNote}
              total={analysis.donanyMissingNoteTotal}
            />
          )}
          {analysis.stavyMissingLokaceTotal > 0 && (
            <AnomalyRow
              title={`Ve stavu, ale bez lokace (${analysis.stavyMissingLokaceTotal})`}
              ids={analysis.stavyMissingLokace}
              total={analysis.stavyMissingLokaceTotal}
            />
          )}
        </div>
      ) : (
        <p className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
          Žádné anomálie — DAROVANÉ mají poznámky, vše ve stavu má i lokaci.
        </p>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
        {label}
      </p>
      <p className="mt-0.5 font-mono text-lg tabular-nums text-gray-900">
        {value.toLocaleString("cs-CZ")}
      </p>
    </div>
  );
}

function AnomalyRow({
  title,
  ids,
  total,
}: {
  title: string;
  ids: number[];
  total: number;
}) {
  return (
    <div className="mb-1 last:mb-0">
      <p className="font-medium">{title}</p>
      <p className="break-words font-mono text-[11px] leading-snug">
        {ids.join(", ")}
        {total > ids.length && (
          <span className="not-italic"> … + {total - ids.length} dalších</span>
        )}
      </p>
    </div>
  );
}

function FindLookup({
  analysis,
  poznamky,
}: {
  analysis: LSPAnalysis;
  poznamky: Record<string, string>;
}) {
  const [query, setQuery] = useState<string>("");
  const trimmed = query.trim();
  const id = /^\d+$/.test(trimmed) ? Number(trimmed) : null;

  const result = useMemo(() => {
    if (id === null) return null;
    return {
      id,
      lokace: analysis.findToLokace[id] ?? null,
      stavy: analysis.findToStavy[id] ?? [],
      poznamka: poznamky[String(id)] ?? null,
      anonymizovany: analysis.anonymizovane.includes(id),
    };
  }, [id, analysis, poznamky]);

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-3 text-sm">
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
        <input
          type="search"
          inputMode="numeric"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Najít nález podle ID (např. 16330)…"
          className="block w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-sm shadow-sm placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
        />
      </div>

      {trimmed && id === null && (
        <p className="mt-2 text-xs text-amber-700">
          Zadej čistě číselné ID nálezu.
        </p>
      )}

      {result && (
        <dl className="mt-3 grid grid-cols-1 gap-y-1.5 text-xs sm:grid-cols-[max-content_1fr] sm:gap-x-4">
          <Row label="Find ID">
            <span className="font-mono">#{result.id}</span>
          </Row>
          <Row label="Lokace">
            {result.lokace !== null ? (
              <span className="font-mono">
                lokace[<strong>{result.lokace}</strong>]
              </span>
            ) : (
              <span className="text-amber-700">
                není v žádné lokaci ⚠
              </span>
            )}
          </Row>
          <Row label="Stavy">
            {result.stavy.length > 0 ? (
              <span className="flex flex-wrap gap-1 font-mono">
                {result.stavy.map((k) => (
                  <span
                    key={k}
                    className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-800"
                  >
                    {k}
                  </span>
                ))}
              </span>
            ) : (
              <span className="text-gray-500">— (NORMAL)</span>
            )}
          </Row>
          <Row label="Anonymizováno">
            <span
              className={
                result.anonymizovany ? "text-amber-800" : "text-gray-500"
              }
            >
              {result.anonymizovany ? "ANO" : "ne"}
            </span>
          </Row>
          <Row label="Poznámka">
            {result.poznamka !== null ? (
              <span className="break-words text-gray-900">{result.poznamka}</span>
            ) : (
              <span className="text-gray-500">—</span>
            )}
          </Row>
          {result.stavy.includes("DAROVANY") && result.poznamka === null && (
            <Row label="">
              <span className="text-amber-700">
                ⚠ DAROVANÝ nález bez poznámky
              </span>
            </Row>
          )}
        </dl>
      )}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-[11px] uppercase tracking-wide text-gray-500">
        {label}
      </dt>
      <dd className="leading-snug">{children}</dd>
    </>
  );
}
