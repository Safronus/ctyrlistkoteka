import Link from "next/link";
import { promises as fs } from "node:fs";
import { ArrowRight, FolderOpen, Lock } from "lucide-react";
import { ensureAdminAuth } from "@/lib/admin/guard";
import { ADMIN_ROOTS } from "@/lib/admin/paths";
import { SCOPES } from "@/lib/admin/scopes";

async function countEntries(absPath: string): Promise<number | null> {
  try {
    const names = await fs.readdir(absPath);
    return names.length;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null;
  }
}

export default async function AdminFilesLandingPage() {
  await ensureAdminAuth();

  const counts = await Promise.all(
    SCOPES.map(async (s) => ({
      slug: s.slug,
      count: await countEntries(ADMIN_ROOTS[s.rootKey]),
    })),
  );
  const countMap = new Map(counts.map((c) => [c.slug, c.count]));

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-gray-900">Soubory</h1>
        <p className="text-sm text-gray-600">
          Prohlížeč obsahu <code>data/</code> a vybraných částí{" "}
          <code>generated/</code>. U writable scopů jde nahrávat, mazat (do{" "}
          <code>.trash/</code>) a hromadně mazat. <span className="text-gray-400">RO</span>{" "}
          označuje read-only oblasti — tam pomocí editorů (např. JSON).
        </p>
      </header>

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {SCOPES.map((s) => {
          const count = countMap.get(s.slug);
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
                  <p className="text-xs text-gray-500">{s.description}</p>
                  <p className="text-xs text-gray-400">
                    {count === null || count === undefined ? (
                      <span>adresář neexistuje</span>
                    ) : (
                      <>
                        {count.toLocaleString("cs-CZ")}{" "}
                        {count === 1
                          ? "položka"
                          : count < 5
                            ? "položky"
                            : "položek"}
                      </>
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
