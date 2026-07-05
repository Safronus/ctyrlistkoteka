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
  CHECK_GROUP_LABELS,
  CHECK_GROUP_ORDER,
  CHECK_SUBCATEGORIES,
  EXIF_CHECK_ID,
  GPS_CHECK_ID,
  runAllChecks,
  type CheckResult,
  type FindOffender,
} from "@/lib/admin/checks";
import { AckCheckButton } from "./ack-button";
import { SyncCropNameButton } from "./sync-crop-name-button";
import { CopyFindIdsButton } from "./copy-find-ids-button";
import { CropOffenderTable } from "./crop-offender-table";
import { DeleteAllCropsButton } from "./delete-all-crops-button";
import { AnonFixButton } from "./anon-fix-button";
import { anonymizeAnonLocationFinds } from "./anonymize-anon-loc-action";
import { anonymizeMismatchedFilenames } from "./anonymize-ne-filename-action";

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

      {/* Group results by their `group` tag and render one section
          per group in CHECK_GROUP_ORDER. Within a section the
          original runAllChecks order is preserved — that's the
          author's choice, more meaningful than re-sorting by id or
          offender count. Empty groups are skipped so the page
          doesn't accidentally grow stub headings. */}
      {CHECK_GROUP_ORDER.map((group) => {
        const inGroup = results.filter((r) => r.group === group);
        if (inGroup.length === 0) return null;
        const groupFailures = inGroup.reduce(
          (n, r) => n + (r.offenders.length > 0 ? 1 : 0),
          0,
        );
        return (
          <CheckGroupSection
            key={group}
            label={CHECK_GROUP_LABELS[group]}
            failureCount={groupFailures}
            totalChecks={inGroup.length}
          >
            {inGroup.map((r) => (
              <CheckCard key={r.id} result={r} />
            ))}
          </CheckGroupSection>
        );
      })}
    </div>
  );
}

/** Renders the body rows of a find-kind check. Splits into two
 *  shapes:
 *    - subgrouped: any offender carries a `subCategory`, so we group
 *      by it in CHECK_SUBCATEGORIES order and emit a colspan row
 *      between groups as a small subheading. Within a group rows
 *      keep their existing findId-ascending order.
 *    - flat: no subCategory present (legacy checks), single sweep.
 *
 *  Returns an array of <tr> nodes — the caller is the <tbody> so
 *  the rows merge cleanly into the surrounding table layout. */
function renderFindOffenderRows(
  offenders: readonly FindOffender[],
  checkId: string,
): React.ReactNode[] {
  const hasSubgroups = offenders.some((o) => o.subCategory !== undefined);
  if (!hasSubgroups) {
    return offenders.map((o, i) => (
      <FindOffenderRow key={`${o.findId}:${i}`} offender={o} checkId={checkId} />
    ));
  }

  // Pre-bucket offenders by sub-category so each render pass is
  // O(N) regardless of how many groups we have. Unknown / missing
  // categories collapse into "Ostatní" at the bottom — defensive,
  // we don't expect it given the enum-typed source but the renderer
  // shouldn't drop rows if the data is loose.
  const buckets = new Map<string, FindOffender[]>();
  for (const o of offenders) {
    const key: string = o.subCategory ?? "Ostatní";
    const arr = buckets.get(key) ?? [];
    arr.push(o);
    buckets.set(key, arr);
  }

  const orderedKeys = [
    ...CHECK_SUBCATEGORIES.filter((k) => buckets.has(k)),
    ...Array.from(buckets.keys()).filter(
      (k) => !(CHECK_SUBCATEGORIES as readonly string[]).includes(k),
    ),
  ];

  const rows: React.ReactNode[] = [];
  for (const key of orderedKeys) {
    const bucket = buckets.get(key) ?? [];
    if (bucket.length === 0) continue;
    rows.push(
      <tr key={`subhdr-${key}`} className="bg-amber-100/60">
        <td
          colSpan={3}
          className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-900"
        >
          {key} · {bucket.length}
        </td>
      </tr>,
    );
    bucket.forEach((o, i) => {
      rows.push(
        <FindOffenderRow
          key={`${key}:${o.findId}:${i}`}
          offender={o}
          checkId={checkId}
        />,
      );
    });
  }
  return rows;
}

/** Sub-category → JSON editor tab. Matches the editor's section keys
 *  (lokace / stavy / poznamky / anonymizace). "Chybějící originál"
 *  isn't section-specific (the find can be missing because it's in
 *  any of the four sections) so it returns null — the JSON link
 *  there opens the editor on its default tab. */
function subCategoryToJsonTab(
  sub: FindOffender["subCategory"],
): string | null {
  switch (sub) {
    case "Lokace":
      return "lokace";
    case "Stav":
      return "stavy";
    case "Poznámka":
      return "poznamky";
    case "Anonymizace":
      return "anonymizace";
    default:
      return null;
  }
}

/** One offender row inside a find-kind check table. Shows the find
 *  id (linked to /sbirka), location code, then detail + (optional)
 *  full filename on a second monospace line. The filename, when
 *  present, doubles as a deep-link to the admin file-detail page —
 *  one click takes the operator straight to the rename / state
 *  toggle surface for that file. A small "JSON →" chip on the
 *  right opens the LokaceStavyPoznamky editor pre-focused on the
 *  matching section, so the operator can fix the other side
 *  without navigating manually. */
function FindOffenderRow({
  offender,
  checkId,
}: {
  offender: FindOffender;
  checkId: string;
}) {
  const jsonTab = subCategoryToJsonTab(offender.subCategory);
  const jsonHref = jsonTab
    ? `/admin/json/lokace-stavy-poznamky?tab=${jsonTab}`
    : "/admin/json/lokace-stavy-poznamky";
  return (
    <tr className="hover:bg-amber-50/40">
      <td className="px-2 py-1.5 align-top">
        <Link
          href={`/sbirka/${offender.findId}`}
          className="font-mono tabular-nums text-brand-700 hover:underline"
        >
          #{offender.findId}
        </Link>
      </td>
      <td className="px-2 py-1.5 align-top font-mono text-gray-800">
        {offender.locationCode}
      </td>
      <td className="px-2 py-1.5 text-gray-600">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            {/* Original ↔ crop thumbnails — the crop-vs-original check sets
                these so the operator sees at a glance whether the "crop" is
                a real cutout (looks different) or the whole photo (looks
                identical). */}
            {(offender.originalThumb || offender.cropThumb) && (
              <div className="mb-1.5 flex items-center gap-2">
                {offender.originalThumb && (
                  <figure className="shrink-0 text-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={offender.originalThumb}
                      alt=""
                      loading="lazy"
                      className="h-16 w-16 rounded border border-gray-300 object-cover"
                    />
                    <figcaption className="text-[9px] uppercase tracking-wide text-gray-400">
                      orig
                    </figcaption>
                  </figure>
                )}
                {offender.cropThumb && (
                  <figure className="shrink-0 text-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={offender.cropThumb}
                      alt=""
                      loading="lazy"
                      className="h-16 w-16 rounded border border-gray-300 object-cover"
                    />
                    <figcaption className="text-[9px] uppercase tracking-wide text-gray-400">
                      ořez
                    </figcaption>
                  </figure>
                )}
              </div>
            )}
            <div>{offender.detail}</div>
            {/* Show both filenames as identifier text when both are
                set (original-vs-crop mismatch). For single-file
                checks the original filename alone sits below. The
                chips on the right are the actionable links. */}
            {offender.filename && (
              <div
                className="mt-1 break-all font-mono text-[11px] text-gray-500"
                title={offender.filename}
              >
                {offender.cropFilename ? "originál: " : ""}
                {offender.filename}
              </div>
            )}
            {offender.cropFilename && (
              <div
                className="break-all font-mono text-[11px] text-gray-500"
                title={offender.cropFilename}
              >
                ořez: {offender.cropFilename}
              </div>
            )}
          </div>
          {/* Action chips — equal-weight links sitting at the right
              edge of the row. Up to three of them:
                - Originál → → /admin/files/finds/<name>
                - Ořez →    → /admin/files/crops/<name> (only when
                  the offender carries cropFilename, i.e. the
                  original-vs-crop mismatch check)
                - JSON →    → /admin/json/lokace-stavy-poznamky?tab=…
                  (only when subCategory is set — the JSON-aware
                  filename↔JSON checks) */}
          <div className="flex shrink-0 items-center gap-1">
            {offender.filename && (
              <Link
                href={`/admin/files/finds/${encodeURIComponent(offender.filename)}`}
                title={`Otevřít originál v adminu: ${offender.filename}`}
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-0.5 text-[11px] font-medium text-gray-700 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800"
              >
                Originál →
              </Link>
            )}
            {offender.cropFilename && (
              <Link
                href={`/admin/files/crops/${encodeURIComponent(offender.cropFilename)}`}
                title={`Otevřít ořez v adminu: ${offender.cropFilename}`}
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-0.5 text-[11px] font-medium text-gray-700 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800"
              >
                Ořez →
              </Link>
            )}
            {/* One-click resolution of the mismatch. Passes only
                findId — the server then re-reads both originals and
                crops directories at action time and computes the
                rename from fresh disk state. The previous round
                passed filenames straight through and renamed the
                crop to match a STALE original filename when the
                operator had fixed the original in another tab. */}
            {offender.filename &&
              offender.cropFilename &&
              checkId === "original-crop-filename-mismatch" && (
                <SyncCropNameButton findId={offender.findId} />
              )}
            {offender.subCategory && (
              <Link
                href={jsonHref}
                title={
                  jsonTab
                    ? `Otevřít LokaceStavyPoznamky.json — sekce ${jsonTab}`
                    : "Otevřít LokaceStavyPoznamky.json"
                }
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-0.5 text-[11px] font-medium text-gray-700 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800"
              >
                JSON →
              </Link>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

function CheckGroupSection({
  label,
  failureCount,
  totalChecks,
  children,
}: {
  label: string;
  failureCount: number;
  totalChecks: number;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className="space-y-3 rounded-2xl border border-gray-200 bg-white/40 p-4"
    >
      <header className="flex items-baseline justify-between gap-3 border-b border-gray-200 pb-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">
          {label}
        </h2>
        <span
          className={`text-xs font-medium ${
            failureCount === 0 ? "text-emerald-700" : "text-amber-700"
          }`}
        >
          {failureCount === 0
            ? `OK · ${totalChecks}`
            : `${failureCount} / ${totalChecks} s problémy`}
        </span>
      </header>
      <div className="space-y-4">{children}</div>
    </section>
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

          {result.id === "crop-same-size-as-original" &&
            result.kind === "find" && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <CopyFindIdsButton
                  ids={result.offenders.map((o) => o.findId)}
                />
                <DeleteAllCropsButton count={result.offenders.length} />
              </div>
            )}

          {result.id === "finds-in-anon-loc-not-anon" && (
            <AnonFixButton
              count={result.offenders.length}
              label="Anonymizovat všechny"
              action={anonymizeAnonLocationFinds}
            />
          )}
          {result.id === "json-not-in-filename" &&
            result.kind === "find" &&
            result.offenders.some((o) => o.subCategory === "Anonymizace") && (
              <AnonFixButton
                count={
                  result.offenders.filter(
                    (o) => o.subCategory === "Anonymizace",
                  ).length
                }
                label="Srovnat +ANO+ v názvech"
                action={anonymizeMismatchedFilenames}
              />
            )}

          {result.id === "crop-same-size-as-original" &&
          result.kind === "find" ? (
            <CropOffenderTable offenders={result.offenders} />
          ) : (
            <div className="mt-4 max-h-96 overflow-auto rounded-md border border-amber-200 bg-white">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">
                    {result.kind === "map" ? "ID mapy" : "ID nálezu"}
                  </th>
                  <th className="px-2 py-1.5 text-left font-medium">Lokalita</th>
                  <th className="px-2 py-1.5 text-left font-medium">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {result.kind === "find"
                  ? renderFindOffenderRows(result.offenders, result.id)
                  : result.offenders.map((o) => (
                      <tr key={o.mapId} className="hover:bg-amber-50/40">
                        <td className="px-2 py-1.5">
                          <Link
                            href={`/admin/files/maps/${encodeURIComponent(o.originalFilename)}`}
                            className="font-mono tabular-nums text-brand-700 hover:underline"
                          >
                            #{o.mapId.toString().padStart(5, "0")}
                          </Link>
                        </td>
                        <td className="px-2 py-1.5 font-mono text-gray-800">
                          {o.locationCode}
                        </td>
                        <td className="px-2 py-1.5 text-gray-600">
                          <div className="flex items-center justify-between gap-2">
                            <span className="min-w-0 flex-1">{o.detail}</span>
                            <AckCheckButton
                              checkId={result.id}
                              offenderId={o.mapId}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
            </div>
          )}
        </>
      )}
    </article>
  );
}
