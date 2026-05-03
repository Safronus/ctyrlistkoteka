"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Database,
  Loader2,
  Plus,
} from "lucide-react";
import {
  SECTION_KEYS,
  SECTION_LABELS,
  type SectionKey,
} from "@/lib/admin/jsonSchema";
import {
  mergeSectionInto,
  type MergeSectionResult,
} from "./merge-action";

const PLACEHOLDERS: Record<SectionKey, string> = {
  anonymizace: `{
  "ANONYMIZOVANE": ["6-7", "17890"]
}`,
  stavy: `{
  "DAROVANY": ["12345", "13000-13002"]
}`,
  poznamky: `{
  "12345": "darováno Petrovi 2026-04",
  "12346": "ztraceno na Lipně"
}`,
  lokace: `{
  "10": ["13608", "14310-14313"],
  "100": ["15157"]
}`,
};

const HINTS: Record<SectionKey, string> = {
  anonymizace:
    "Range pole sjednoceno bez duplicit. ID 6 ani range 6-7 se nepřidá, když už 6 v existujících rangech leží.",
  stavy:
    "Stačí jen klíče, které potřebuješ aktualizovat (DAROVANY, BEZGPS, …). Ostatní zůstanou nedotčené. Range merge stejný jako u Anonymizace.",
  poznamky:
    "Sloučení po klíčích. Stejné ID s identickým textem = no-op. Stejné ID s odlišným textem = konflikt — merge selže a nabídne ti seznam k vyřešení v editoru.",
  lokace:
    "Klíče jsou MAP_ID (číselný řetězec, např. \"10\" = mapa #00010), hodnoty jsou range pole nálezů přiřazených k té mapě. Range pole se merguje, nové map ID se přidají. Existující ranges pro daný klíč zůstanou — jen se k nim přidají chybějící IDs.",
};

/** Hromadný merge do existující sekce LokaceStavyPoznamky.json.
 *  Ušetří klikání v editoru, když má operátor seznam IDs / poznámek
 *  připravený jinde a chce ho jen nalít — duplicity se zahodí, range
 *  pole se sjednotí a recompactují. */
export function MergeSectionForm() {
  const [section, setSection] = useState<SectionKey>("lokace");
  const [content, setContent] = useState("");
  const [result, setResult] = useState<MergeSectionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setResult(null);
    if (content.trim().length === 0) {
      setResult({ ok: false, error: "Vstup je prázdný" });
      return;
    }
    const fd = new FormData();
    fd.append("section", section);
    fd.append("content", content);
    startTransition(async () => {
      const r = await mergeSectionInto(fd);
      setResult(r);
      if (r.ok && !r.noChanges) {
        router.refresh();
        setContent("");
      }
    });
  };

  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <header className="space-y-1">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Plus className="h-4 w-4 text-brand-600" aria-hidden />
          Hromadný merge do sekce
        </h2>
        <p className="text-xs text-gray-600">
          Vlož partial JSON ve stejném tvaru, jako má cílová sekce. Range pole
          se sjednotí, číselné duplicity se zahodí, nové klíče se přidají.
          Konfliktní hodnoty (stejný klíč, jiný text) merge odmítne — vyřeš je
          v editoru a zopakuj.
        </p>
      </header>

      <form onSubmit={submit} className="space-y-3">
        <div className="flex flex-wrap gap-1">
          {SECTION_KEYS.map((key) => (
            <button
              type="button"
              key={key}
              onClick={() => {
                setSection(key);
                setResult(null);
              }}
              disabled={isPending}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${
                section === key
                  ? "border-brand-400 bg-brand-50 text-brand-900"
                  : "border-gray-300 bg-white text-gray-700 hover:border-gray-400 hover:bg-gray-50"
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {SECTION_LABELS[key]}
            </button>
          ))}
        </div>

        <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] text-gray-700">
          {HINTS[section]}
        </p>

        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={PLACEHOLDERS[section]}
          rows={8}
          spellCheck={false}
          disabled={isPending}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-xs leading-snug text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-60"
        />

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={isPending || content.trim().length === 0}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            )}
            Sloučit do {SECTION_LABELS[section]}
          </button>
          {content.length > 0 && !isPending && (
            <button
              type="button"
              onClick={() => {
                setContent("");
                setResult(null);
              }}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Vymazat
            </button>
          )}
        </div>
      </form>

      {result && <ResultPanel result={result} />}
    </section>
  );
}

function ResultPanel({ result }: { result: MergeSectionResult }) {
  if (result.ok) {
    if (result.noChanges) {
      return (
        <div className="flex items-start gap-2 rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">
          <CheckCircle2
            className="mt-0.5 h-4 w-4 shrink-0 text-gray-500"
            aria-hidden
          />
          <div>
            <p className="font-medium">Beze změny</p>
            <p>
              Vstup neobsahuje nic, co by v sekci{" "}
              <strong>{result.section}</strong> ještě nebylo. Žádný zápis se
              neprovedl.
            </p>
            {result.alreadyPresentIds && result.alreadyPresentIds.length > 0 && (
              <p className="mt-1 text-gray-500">
                Již obsažených ID: {result.alreadyPresentIds.length} (
                {previewIds(result.alreadyPresentIds, 20)})
              </p>
            )}
            {result.alreadyPresentKeys &&
              result.alreadyPresentKeys.length > 0 && (
                <p className="mt-1 text-gray-500">
                  Již obsažených klíčů: {result.alreadyPresentKeys.length} (
                  {result.alreadyPresentKeys.slice(0, 10).join(", ")}
                  {result.alreadyPresentKeys.length > 10 ? ", …" : ""})
                </p>
              )}
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
        <div className="flex items-start gap-2">
          <CheckCircle2
            className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"
            aria-hidden
          />
          <div className="space-y-1">
            <p className="font-medium">
              Sloučeno do <strong>{result.section}</strong>.
            </p>
            {result.addedIds && result.addedIds.length > 0 && (
              <p>
                Přidaných ID: <strong>{result.addedIds.length}</strong> (
                {previewIds(result.addedIds, 30)})
              </p>
            )}
            {result.alreadyPresentIds &&
              result.alreadyPresentIds.length > 0 && (
                <p>
                  Již obsažených ID (přeskočeno):{" "}
                  {result.alreadyPresentIds.length} (
                  {previewIds(result.alreadyPresentIds, 20)})
                </p>
              )}
            {result.addedKeys && result.addedKeys.length > 0 && (
              <p>
                Přidané klíče:{" "}
                <code className="text-[11px]">
                  {result.addedKeys.slice(0, 10).join(", ")}
                  {result.addedKeys.length > 10
                    ? `, … (+${result.addedKeys.length - 10})`
                    : ""}
                </code>
              </p>
            )}
            {result.alreadyPresentKeys &&
              result.alreadyPresentKeys.length > 0 && (
                <p>
                  Beze změny (stejná hodnota):{" "}
                  {result.alreadyPresentKeys.length}
                </p>
              )}
          </div>
        </div>
        <Link
          href="/admin/sync?preset=meta"
          className="inline-flex items-center gap-1.5 self-start rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-800 transition hover:border-emerald-400 hover:bg-emerald-50/60"
        >
          <Database className="h-3.5 w-3.5" aria-hidden />
          Spustit sync --only=meta
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
    );
  }

  if (result.parseError) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-900">
        <p className="font-medium">JSON parse chyba</p>
        <p className="font-mono">
          {result.parseError.message}
          {result.parseError.line && (
            <span className="text-red-700">
              {" "}
              (řádek {result.parseError.line}, sloupec{" "}
              {result.parseError.column})
            </span>
          )}
        </p>
      </div>
    );
  }

  if (result.issues && result.issues.length > 0) {
    return (
      <div className="space-y-1 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        <p className="font-medium">Validační problémy</p>
        <ul className="space-y-0.5 font-mono">
          {result.issues.map((issue, i) => (
            <li key={i}>
              <strong>{issue.path.join(".") || "(root)"}</strong> —{" "}
              {issue.message}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (result.conflicts && result.conflicts.length > 0) {
    return (
      <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        <div className="flex items-start gap-2">
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
            aria-hidden
          />
          <p className="font-medium">{result.error}</p>
        </div>
        <ul className="space-y-1">
          {result.conflicts.map((c, i) => (
            <li key={i} className="rounded border border-amber-300 bg-amber-100/60 p-2">
              <code className="font-medium">{c.path}</code>
              <div className="mt-0.5 text-[11px]">
                <span className="text-amber-800">Existující:</span>{" "}
                <span className="font-mono">
                  {previewText(c.existing, 200)}
                </span>
              </div>
              <div className="text-[11px]">
                <span className="text-amber-800">V merge inputu:</span>{" "}
                <span className="font-mono">
                  {previewText(c.incoming, 200)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-900">
      <p className="font-medium">Chyba</p>
      <p>{result.error ?? "Neznámá chyba"}</p>
    </div>
  );
}

function previewIds(ids: number[], limit: number): string {
  if (ids.length <= limit) return ids.join(", ");
  return `${ids.slice(0, limit).join(", ")}, … (+${ids.length - limit})`;
}

function previewText(s: string, limit: number): string {
  if (s.length <= limit) return s;
  return `${s.slice(0, limit)}…`;
}
