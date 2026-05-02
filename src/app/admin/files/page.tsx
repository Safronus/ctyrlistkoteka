import Link from "next/link";
import { promises as fs } from "node:fs";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FolderOpen,
  Lock,
} from "lucide-react";
import { ensureAdminAuth } from "@/lib/admin/guard";
import { ADMIN_ROOTS } from "@/lib/admin/paths";
import { listScopeFindIds, SCOPES } from "@/lib/admin/scopes";

/** Returns the visible item count for a scope's root, or null when the
 *  directory doesn't exist. Matches what `listScope` shows: hidden
 *  entries (`.DS_Store`, `._*` resource forks, atomic-write `.tmp`
 *  files) are excluded so the landing card and the listing don't drift. */
async function countVisibleEntries(absPath: string): Promise<number | null> {
  try {
    const names = await fs.readdir(absPath);
    return names.filter((n) => !n.startsWith(".")).length;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null;
  }
}

function formatItemCount(count: number): string {
  return `${count.toLocaleString("cs-CZ")} ${
    count === 1 ? "položka" : count < 5 ? "položky" : "položek"
  }`;
}

export default async function AdminFilesLandingPage() {
  await ensureAdminAuth();

  const counts = await Promise.all(
    SCOPES.map(async (s) => ({
      slug: s.slug,
      count: await countVisibleEntries(ADMIN_ROOTS[s.rootKey]),
    })),
  );
  const countMap = new Map(counts.map((c) => [c.slug, c.count]));

  // finds ↔ crops gap. Compare the FIND IDs in each scope (not raw
  // filenames — crops can have shorter `<id>.jpg` form, originals
  // always have the 6-segment convention). Symmetric difference tells
  // the user "X originálů bez crops, Y crops bez originálů" at a
  // glance, which is the failure mode that bites most often.
  const findsScope = SCOPES.find((s) => s.slug === "finds")!;
  const cropsScope = SCOPES.find((s) => s.slug === "crops")!;
  const [findsIds, cropsIds] = await Promise.all([
    listScopeFindIds(findsScope),
    listScopeFindIds(cropsScope),
  ]);
  const findsWithoutCrops: number[] = [];
  for (const id of findsIds) if (!cropsIds.has(id)) findsWithoutCrops.push(id);
  const cropsWithoutFinds: number[] = [];
  for (const id of cropsIds) if (!findsIds.has(id)) cropsWithoutFinds.push(id);
  findsWithoutCrops.sort((a, b) => a - b);
  cropsWithoutFinds.sort((a, b) => a - b);
  const coverageMatches =
    findsWithoutCrops.length === 0 && cropsWithoutFinds.length === 0;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-gray-900">Soubory</h1>
        <p className="text-sm text-gray-600">
          Prohlížeč obsahu <code>data/</code> a vybraných částí{" "}
          <code>generated/</code>. U writable scopů jde nahrávat, mazat (do{" "}
          <code>.trash/</code>) a hromadně mazat.{" "}
          <span className="text-gray-400">RO</span> označuje read-only oblasti
          — tam pomocí editorů (např. JSON). Skryté soubory (
          <code>.DS_Store</code>, <code>._*</code>, atomické <code>.tmp</code>)
          se nezapočítávají.
        </p>
      </header>

      <CoverageBanner
        findsCount={countMap.get("finds") ?? 0}
        cropsCount={countMap.get("crops") ?? 0}
        findsWithoutCrops={findsWithoutCrops}
        cropsWithoutFinds={cropsWithoutFinds}
        matches={coverageMatches}
      />

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {SCOPES.map((s) => {
          const count = countMap.get(s.slug);
          const isFinds = s.slug === "finds";
          const isCrops = s.slug === "crops";
          const showCoverageBadge =
            (isFinds && findsWithoutCrops.length > 0) ||
            (isCrops && cropsWithoutFinds.length > 0);
          const coverageBadgeText = isFinds
            ? `${findsWithoutCrops.length.toLocaleString("cs-CZ")} bez crops`
            : isCrops
              ? `${cropsWithoutFinds.length.toLocaleString("cs-CZ")} bez originálu`
              : null;
          return (
            <li key={s.slug}>
              <Link
                href={`/admin/files/${s.slug}`}
                className="flex h-full items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-brand-300 hover:bg-brand-50/30"
              >
                <FolderOpen
                  className="mt-0.5 h-5 w-5 shrink-0 text-brand-600"
                  aria-hidden
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold text-gray-900">
                      {s.label}
                    </h2>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {showCoverageBadge && coverageBadgeText && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800"
                          title={
                            isFinds
                              ? "Originály, ke kterým chybí výřez se stejným ID"
                              : "Crops, ke kterým chybí originál se stejným ID"
                          }
                        >
                          <AlertTriangle className="h-3 w-3" aria-hidden />
                          {coverageBadgeText}
                        </span>
                      )}
                      {!s.writable && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500"
                          title="Read-only — uprav přes specializovaný editor"
                        >
                          <Lock className="h-3 w-3" aria-hidden />
                          RO
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-gray-500">{s.description}</p>
                  <p className="text-xs text-gray-400">
                    {count === null || count === undefined ? (
                      <span>adresář neexistuje</span>
                    ) : (
                      formatItemCount(count)
                    )}
                  </p>
                </div>
                <ArrowRight
                  className="mt-1 h-4 w-4 shrink-0 text-gray-400"
                  aria-hidden
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const PREVIEW_IDS = 12;

function CoverageBanner({
  findsCount,
  cropsCount,
  findsWithoutCrops,
  cropsWithoutFinds,
  matches,
}: {
  findsCount: number;
  cropsCount: number;
  findsWithoutCrops: number[];
  cropsWithoutFinds: number[];
  matches: boolean;
}) {
  if (matches) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
        <CheckCircle2
          className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"
          aria-hidden
        />
        <div className="space-y-0.5">
          <p className="font-medium">
            Pokrytí originály ↔ crops sedí ({findsCount.toLocaleString("cs-CZ")}{" "}
            ku {cropsCount.toLocaleString("cs-CZ")}).
          </p>
          <p className="text-xs text-emerald-800/80">
            Každý nález má originál i výřez se stejným ID.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <div className="flex items-start gap-2">
        <AlertTriangle
          className="mt-0.5 h-4 w-4 shrink-0 text-amber-700"
          aria-hidden
        />
        <div className="space-y-0.5">
          <p className="font-medium">
            Originály ({findsCount.toLocaleString("cs-CZ")}) a crops (
            {cropsCount.toLocaleString("cs-CZ")}) se neshodují.
          </p>
          <p className="text-xs text-amber-800/80">
            Porovnání podle ID nálezu (vedoucí číselný úsek názvu).
          </p>
        </div>
      </div>
      <ul className="grid grid-cols-1 gap-x-4 gap-y-1 pl-6 text-xs sm:grid-cols-2">
        <li>
          <span className="font-medium">
            {findsWithoutCrops.length.toLocaleString("cs-CZ")}
          </span>{" "}
          originálů bez crop:{" "}
          <IdPreview ids={findsWithoutCrops} />
        </li>
        <li>
          <span className="font-medium">
            {cropsWithoutFinds.length.toLocaleString("cs-CZ")}
          </span>{" "}
          crops bez originálu:{" "}
          <IdPreview ids={cropsWithoutFinds} />
        </li>
      </ul>
    </div>
  );
}

function IdPreview({ ids }: { ids: number[] }) {
  if (ids.length === 0) return <span className="text-amber-800/70">—</span>;
  const head = ids.slice(0, PREVIEW_IDS);
  const rest = ids.length - head.length;
  return (
    <span className="font-mono tabular-nums text-amber-900">
      {head.join(", ")}
      {rest > 0 && (
        <span className="text-amber-800/70">{` … +${rest.toLocaleString(
          "cs-CZ",
        )} dalších`}</span>
      )}
    </span>
  );
}
