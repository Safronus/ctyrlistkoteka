"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { importDropXlsxAction, type ImportReport } from "../../drop-actions";

/**
 * Bulk editing through a spreadsheet — the thing a web form is worst at.
 *
 * Export gives every card's position, texts, crew and status; the same
 * file comes back after being edited in Excel. The round-trip rules
 * (find number is the key, empty means inherit) live in
 * lib/admin/dropXlsx.ts and are also written into a "Návod" sheet inside
 * the file itself.
 */
export function XlsxPanel({
  campaignId,
  campaignName,
}: {
  campaignId: number;
  campaignName: string;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const upload = (file: File) => {
    setError(null);
    setReport(null);
    start(async () => {
      const fd = new FormData();
      fd.set("file", file);
      const r = await importDropXlsxAction(campaignId, fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setReport(r.report);
      if (r.report.changed > 0) router.refresh();
    });
  };

  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
        <FileSpreadsheet className="h-4 w-4 text-emerald-600" aria-hidden />
        Tabulka (xlsx)
      </h2>
      <p className="text-xs text-gray-500">
        Stáhni celou sadu, uprav v Excelu a nahraj zpět. Řádky se párují podle
        čísla nálezu; prázdná buňka u textu znamená „převzít ze sady“. Uvnitř
        souboru je list <em>Návod</em> s pravidly.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <a
          href={`/admin/api/drops/${campaignId}/xlsx`}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
        >
          <Download className="h-4 w-4" aria-hidden />
          Stáhnout „{campaignName}“
        </a>

        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) upload(f);
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900 transition hover:bg-emerald-100 disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Upload className="h-4 w-4" aria-hidden />
          )}
          Nahrát upravenou tabulku
        </button>
      </div>

      {error && (
        <p className="rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
          {error}
        </p>
      )}

      {report && <Report report={report} />}
    </section>
  );
}

function Report({ report }: { report: ImportReport }) {
  const blocked = report.errors.length > 0;
  return (
    <div
      className={`space-y-1.5 rounded-lg border px-3 py-2 text-xs ${
        blocked
          ? "border-red-200 bg-red-50 text-red-900"
          : "border-emerald-200 bg-emerald-50 text-emerald-900"
      }`}
    >
      {blocked ? (
        <>
          <p className="font-medium">
            Import neproběhl — nejdřív oprav tohle v souboru:
          </p>
          <ul className="list-disc space-y-0.5 pl-4">
            {report.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <p className="font-medium">
            Načteno {report.matched} řádků · změněno {report.changed} kusů
            {report.cleared > 0 && ` · vyprázdněno ${report.cleared} polí`}
          </p>
          {report.changed === 0 && <p>V souboru nebyla žádná změna.</p>}
          {report.unknownFinds.length > 0 && (
            <p className="text-amber-800">
              Přeskočeno {report.unknownFinds.length} čísel, která v sadě
              nejsou: {report.unknownFinds.slice(0, 12).join(", ")}
              {report.unknownFinds.length > 12 && "…"}
            </p>
          )}
          {report.unknownAreas.length > 0 && (
            <p className="text-amber-800">
              Neznámé oblasti (nepřiřazeno):{" "}
              {report.unknownAreas.join(", ")}
            </p>
          )}
          {report.unknownPlacers.length > 0 && (
            <p className="text-amber-800">
              Jména mimo tým (uložena i tak):{" "}
              {report.unknownPlacers.join(", ")}
            </p>
          )}
        </>
      )}
    </div>
  );
}
