"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Database,
  FilePenLine,
  RotateCcw,
  X,
} from "lucide-react";
// Type-only — erased at compile time, so nothing of the modules (zod, the
// prisma enums, node:fs) reaches the client bundle.
import type {
  FindUpdateCommitSummary,
  UpdateSyncStart,
} from "@/lib/admin/findUpdateImport";
import type { FindSide, FindUpdateItem, FindUpdatePlan } from "@/lib/findUpdatePackage";
import { pluralCs } from "@/lib/format";

/**
 * Review of an "oprava-nalezu" package: per find, what the site shows now
 * and what it will show after the correction. Errors block everything (one
 * error anywhere = nothing is applied, contract §6).
 *
 * Confirming is only possible for a package without errors; the server
 * re-runs every check before it writes anyway.
 */
export function UpdateReviewCard({
  plan,
  fileName,
  onConfirm,
  onCancel,
}: {
  plan: FindUpdatePlan;
  fileName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const changed = plan.finds.filter((f) => f.changed).length;
  const errorCount =
    plan.errors.length + plan.finds.reduce((n, f) => n + f.errors.length, 0);

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <header className="mb-3 flex items-center gap-2">
        <FilePenLine className="h-5 w-5 text-brand-600" aria-hidden />
        <h2 className="text-sm font-semibold text-gray-900">
          Opravný balíček nálezů — kontrola
        </h2>
      </header>
      <p className="mb-3 text-xs text-gray-500">
        {fileName} — oprava <strong>{plan.finds.length}</strong>{" "}
        {pluralCs(plan.finds.length, ["nálezu", "nálezů", "nálezů"])} (
        <span className="text-amber-700">{changed} se změní</span> ·{" "}
        {plan.finds.length - changed} beze změny)
        {plan.generator ? ` · ${plan.generator}` : ""}
        {plan.generatedAt ? ` · zabaleno ${plan.generatedAt}` : ""}
      </p>

      {plan.ok ? (
        <Banner tone="ok">
          Balíček prošel všemi kontrolami (V1–V10).
        </Banner>
      ) : (
        <Banner tone="error">
          {errorCount} {pluralCs(errorCount, ["chyba", "chyby", "chyb"])} —
          balíček se <strong>nepoužije</strong> (stačí jediná chyba). Oprav ho
          na desktopu a nahraj znovu.
        </Banner>
      )}
      {plan.errors.map((e) => (
        <Banner key={e} tone="error">
          {e}
        </Banner>
      ))}
      {plan.warnings.map((w) => (
        <Banner key={w} tone="warn">
          {w}
        </Banner>
      ))}

      <div className="mt-2 max-h-[32rem] overflow-auto rounded-lg border border-gray-200">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-gray-50 text-gray-500">
            <tr>
              <th className="px-2 py-1.5 font-semibold">Číslo</th>
              <th className="px-2 py-1.5 font-semibold">Stavy</th>
              <th className="px-2 py-1.5 font-semibold">Poznámka</th>
              <th className="px-2 py-1.5 font-semibold">Anonymní</th>
              <th className="px-2 py-1.5 font-semibold">Mapa</th>
              <th className="px-2 py-1.5 font-semibold">Fotky</th>
            </tr>
          </thead>
          <tbody>
            {plan.finds.map((f) => (
              <FindRows key={f.findId} f={f} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
        Potvrzení zapíše fotky a <code>LokaceStavyPoznamky.json</code> najednou
        — buď všechno, nebo nic (staré soubory jdou do koše). Na webu se změny
        projeví až po <strong>syncu</strong>. Nespouštěj při tom sync ručně
        z terminálu na serveru — ten tady vidět není.
      </p>

      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
          Zrušit
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={!plan.ok}
          title={plan.ok ? undefined : "Balíček má chyby — oprav ho na desktopu"}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
          Potvrdit opravu
        </button>
      </div>
    </section>
  );
}

/** Result of a written correction, and the one thing left to do. */
export function UpdateDoneCard({
  summary,
  sync,
  onReset,
}: {
  summary: FindUpdateCommitSummary;
  /** null = an older server that did not start the sync on its own. */
  sync: UpdateSyncStart | null;
  onReset: () => void;
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <header className="mb-3 flex items-center gap-2">
        <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden />
        <h2 className="text-sm font-semibold text-gray-900">Oprava zapsána</h2>
      </header>
      <ul className="space-y-0.5 text-xs text-gray-700">
        <li>
          Opravené nálezy: <strong>{summary.finds}</strong>.
        </li>
        <li>
          Fotky: {summary.renamed} jen přejmenováno (beze změny obsahu),{" "}
          {summary.written} nových, {summary.unchanged} už bylo na místě.
        </li>
        <li>
          Do koše: {summary.trashed}{" "}
          {pluralCs(summary.trashed, ["soubor", "soubory", "souborů"])}
          {summary.trashBucket ? (
            <>
              {" "}
              (<code>data/.trash/{summary.trashBucket}</code>)
            </>
          ) : null}
          .
        </li>
        {summary.noteOverridesRemoved > 0 && (
          <li>
            Smazané webové přepisy poznámky: {summary.noteOverridesRemoved}. EN
            překlad se znovu objeví ve frontě překladů — kromě darovaných
            a anonymizovaných nálezů, jejichž poznámku web nezobrazuje.
          </li>
        )}
        <li>
          <code>LokaceStavyPoznamky.json</code> zapsán (předchozí verze je
          v zálohách editoru a v koši).
        </li>
      </ul>

      <div
        className={`mt-4 rounded-lg border p-3 ${
          sync && !sync.started
            ? "border-amber-200 bg-amber-50/60"
            : "border-brand-200 bg-brand-50/50"
        }`}
      >
        {sync?.started ? (
          <p className="text-xs text-gray-700">
            Data jsou na disku a <strong>sync už běží</strong> — oprava se na
            webu projeví po jeho dokončení. Průběh sleduj na stránce Sync.
          </p>
        ) : sync ? (
          <p className="flex items-start gap-1.5 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              Data jsou na disku, ale sync se nespustil: {sync.reason} Na webu se
              oprava projeví až po <strong>syncu</strong> — spusť ho ručně.
            </span>
          </p>
        ) : (
          <p className="text-xs text-gray-700">
            Data jsou na disku. Na webu se oprava projeví až po{" "}
            <strong>syncu</strong> — spusť ho teď.
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Link
            href="/admin/sync"
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700"
          >
            <Database className="h-4 w-4" aria-hidden />
            {sync?.started ? "Sledovat sync" : "Přejít na Sync"}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
            Nahrát další balíček
          </button>
        </div>
      </div>
    </section>
  );
}

function FindRows({ f }: { f: FindUpdateItem }) {
  const problems = f.errors.length + f.warnings.length;
  return (
    <>
      <tr className={`border-t border-gray-100 align-top ${f.errors.length > 0 ? "bg-red-50/60" : ""}`}>
        <td className="px-2 py-1 font-mono text-gray-700">
          {f.findId}
          {!f.changed && <span className="ml-1 font-sans text-gray-400">(beze změny)</span>}
        </td>
        <td className="px-2 py-1">
          <Diff before={states(f.before)} after={states(f.after)} />
        </td>
        <td className="max-w-[16rem] px-2 py-1">
          <Diff before={f.before.note ?? "—"} after={f.after.note ?? "—"} />
          {f.noteOverride === "removed" && (
            <span className="mt-0.5 block text-[11px] text-amber-700">
              webový přepis poznámky (cs+en) se smaže
            </span>
          )}
        </td>
        <td className="px-2 py-1">
          <Diff before={anon(f.before)} after={anon(f.after)} />
        </td>
        <td className="px-2 py-1 font-mono">
          <Diff before={map(f.before)} after={map(f.after)} />
        </td>
        <td className="px-2 py-1 text-gray-600">
          originál {f.images.original === "same" ? "beze změny" : <strong className="text-amber-700">nový</strong>}
          <br />
          ořez {f.images.crop === "same" ? "beze změny" : <strong className="text-amber-700">nový</strong>}
        </td>
      </tr>
      {problems > 0 && (
        <tr className={f.errors.length > 0 ? "bg-red-50/60" : ""}>
          <td />
          <td colSpan={5} className="px-2 pb-1.5">
            {f.errors.map((e) => (
              <span key={e} className="flex items-start gap-1 text-[11px] text-red-800">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                {e}
              </span>
            ))}
            {f.warnings.map((w) => (
              <span key={w} className="block text-[11px] text-amber-700">
                {w}
              </span>
            ))}
          </td>
        </tr>
      )}
    </>
  );
}

/** "old → new" when it changes, the value alone (muted) when it doesn't. */
function Diff({ before, after }: { before: string; after: string }) {
  if (before === after) return <span className="text-gray-500">{after}</span>;
  return (
    <span>
      <span className="text-gray-400 line-through">{before}</span>{" "}
      <span className="text-gray-400">→</span>{" "}
      <strong className="text-gray-900">{after}</strong>
    </span>
  );
}

function states(s: FindSide): string {
  return s.states.length > 0 ? s.states.join(", ") : "—";
}

/** Anonymous either through the filename or the LSP list. */
function anon(s: FindSide): string {
  return s.anonymizedInName || s.anonymizedInLsp ? "ano" : "ne";
}

function map(s: FindSide): string {
  return s.mapNumber === null ? "—" : String(s.mapNumber).padStart(5, "0");
}

function Banner({ tone, children }: { tone: "ok" | "error" | "warn"; children: React.ReactNode }) {
  const cls =
    tone === "ok"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : tone === "error"
        ? "border-red-200 bg-red-50 text-red-800"
        : "border-amber-200 bg-amber-50 text-amber-900";
  const Icon = tone === "ok" ? CheckCircle2 : AlertTriangle;
  return (
    <p className={`mb-2 flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${cls}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}
