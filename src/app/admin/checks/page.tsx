import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Crop,
  Image as ImageIcon,
} from "lucide-react";
import { ensureAdminAuth } from "@/lib/admin/guard";
import {
  EXIF_CHECK_ID,
  GPS_CHECK_ID,
  runAllChecks,
  type CheckResult,
} from "@/lib/admin/checks";

export const dynamic = "force-dynamic";

export default async function AdminChecksPage() {
  await ensureAdminAuth();
  const results = await runAllChecks();
  const totalIssues = results.reduce(
    (acc, r) => acc + r.offenders.length,
    0,
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 hover:text-gray-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Přehled
        </Link>
        <span aria-hidden>/</span>
        <span className="text-gray-900">Kontroly</span>
      </div>

      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-gray-900">Kontroly konzistence</h1>
        <p className="text-sm text-gray-600">
          {totalIssues === 0
            ? "Všechny aktuální kontroly procházejí. Data sedí."
            : `Otevřených problémů: ${totalIssues}. Detail v jednotlivých kartách níž.`}
        </p>
      </header>

      <section className="space-y-4">
        {results.map((r) => (
          <CheckCard key={r.id} result={r} />
        ))}
      </section>
    </div>
  );
}

function CheckCard({ result }: { result: CheckResult }) {
  const ok = result.offenders.length === 0;
  return (
    <article
      className={`rounded-xl border p-5 shadow-sm ${
        ok
          ? "border-emerald-200 bg-emerald-50/40"
          : "border-amber-300 bg-amber-50/40"
      }`}
    >
      <header className="flex items-start gap-3">
        {ok ? (
          <CheckCircle2
            className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600"
            aria-hidden
          />
        ) : (
          <AlertTriangle
            className="mt-0.5 h-5 w-5 shrink-0 text-amber-600"
            aria-hidden
          />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-gray-900">
            {result.title}
          </h2>
          <p className="mt-1 text-xs text-gray-600">{result.description}</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            ok
              ? "bg-emerald-100 text-emerald-800"
              : "bg-amber-200 text-amber-900"
          }`}
        >
          {ok ? "OK" : `${result.offenders.length} problémů`}
        </span>
      </header>

      {!ok && (
        <>
          {/* Cross-link to the filesystem views — for the EXIF + GPS
              checks, listing the broken originals/crops side-by-side
              with the rest of the file tree lets the operator spot
              patterns (a whole batch from one location lost EXIF,
              indoor photos missing GPS) before sync ingests them. */}
          {(result.id === EXIF_CHECK_ID || result.id === GPS_CHECK_ID) && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href={`/admin/files/finds?${
                  result.id === EXIF_CHECK_ID ? "exif_broken" : "gps_broken"
                }=1`}
                className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 shadow-sm hover:bg-amber-50"
              >
                <ImageIcon className="h-3.5 w-3.5" aria-hidden />
                Originály s problémem ({result.offenders.length})
              </Link>
              <Link
                href={`/admin/files/crops?${
                  result.id === EXIF_CHECK_ID ? "exif_broken" : "gps_broken"
                }=1`}
                className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 shadow-sm hover:bg-amber-50"
              >
                <Crop className="h-3.5 w-3.5" aria-hidden />
                Ořezy s problémem
              </Link>
            </div>
          )}

          <div className="mt-4 max-h-96 overflow-auto rounded-md border border-amber-200 bg-white">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">ID nálezu</th>
                  <th className="px-2 py-1.5 text-left font-medium">Lokalita</th>
                  <th className="px-2 py-1.5 text-left font-medium">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {result.offenders.map((o) => (
                  <tr key={o.findId} className="hover:bg-amber-50/40">
                    <td className="px-2 py-1.5">
                      <Link
                        href={`/sbirka/${o.findId}`}
                        className="font-mono tabular-nums text-brand-700 hover:underline"
                      >
                        #{o.findId}
                      </Link>
                    </td>
                    <td className="px-2 py-1.5 font-mono text-gray-800">
                      {o.locationCode}
                    </td>
                    <td className="px-2 py-1.5 text-gray-600">{o.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </article>
  );
}
