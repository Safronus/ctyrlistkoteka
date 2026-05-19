import Link from "next/link";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ArrowLeft } from "lucide-react";
import { ensureAdminAuth } from "@/lib/admin/guard";
import { prisma } from "@/lib/db";
import {
  LOKACE_HIERARCHIE_FILENAME,
  lokaceHierarchieSchema,
  type LokaceHierarchie,
} from "@/lib/admin/jsonSchema";
import { ADMIN_ROOTS } from "@/lib/admin/paths";
import { LokaceHierarchieEditor } from "./editor";

export const dynamic = "force-dynamic";

const TARGET_PATH = path.join(ADMIN_ROOTS.meta, LOKACE_HIERARCHIE_FILENAME);

export interface LocationOption {
  code: string;
  name: string;
  /** True if the location currently has finds attached. Surfaced in
   *  the picker so the user can prioritise non-empty locations when
   *  building groups. */
  hasFinds: boolean;
}

interface LoadResult {
  hierarchy: LokaceHierarchie;
  mtimeIso: string | null;
  loadError: string | null;
}

async function loadHierarchy(): Promise<LoadResult> {
  let raw: string;
  let mtimeIso: string | null = null;
  try {
    raw = await fs.readFile(TARGET_PATH, "utf8");
    const stat = await fs.stat(TARGET_PATH);
    mtimeIso = stat.mtime.toISOString();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { hierarchy: {}, mtimeIso: null, loadError: null };
    }
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      hierarchy: {},
      mtimeIso,
      loadError:
        err instanceof Error
          ? `Soubor neparsuje jako JSON: ${err.message}. Editor startuje s prázdným stavem — uložení přepíše rozbitý obsah.`
          : "Soubor neparsuje jako JSON.",
    };
  }
  const result = lokaceHierarchieSchema.safeParse(parsed);
  if (!result.success) {
    // Tolerate broken-shape input on load: the editor will let the
    // user rebuild from scratch (Save then validates again). We don't
    // try to salvage partial data here — too many corner cases.
    return {
      hierarchy: {},
      mtimeIso,
      loadError: `Současný obsah neprošel validací (${result.error.issues.length} ${
        result.error.issues.length === 1 ? "problém" : "problémů"
      }). Editor startuje s prázdným stavem — uložení nahradí celý soubor.`,
    };
  }
  return { hierarchy: result.data, mtimeIso, loadError: null };
}

async function loadLocations(): Promise<LocationOption[]> {
  const rows = await prisma.location.findMany({
    select: {
      code: true,
      displayName: true,
      _count: { select: { finds: true } },
    },
    orderBy: { code: "asc" },
  });
  return rows.map((r) => ({
    code: r.code,
    name: r.displayName,
    hasFinds: r._count.finds > 0,
  }));
}

export default async function LokaceHierarchiePage() {
  await ensureAdminAuth();
  const [{ hierarchy, mtimeIso, loadError }, locations] = await Promise.all([
    loadHierarchy(),
    loadLocations(),
  ]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="space-y-1">
          <Link
            href="/admin"
            className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
          >
            <ArrowLeft className="h-3 w-3" aria-hidden />
            Zpět na přehled
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">
            Hierarchie lokalit
          </h1>
          <p className="max-w-3xl text-sm text-gray-600">
            Označ lokaci jako rodičovskou a přiřaď k ní dětské lokality.
            Rodičovské lokace agregují statistiky a hustotu ze všech svých
            dětí (viz <code>src/lib/queries/locations.ts</code>). Soubor:{" "}
            <code>data/meta/{LOKACE_HIERARCHIE_FILENAME}</code>.
          </p>
        </div>
        {mtimeIso ? (
          <p className="text-xs text-gray-500">
            Poslední úprava souboru:{" "}
            <time dateTime={mtimeIso}>
              {new Date(mtimeIso).toLocaleString("cs-CZ", {
                timeZone: "Europe/Prague",
              })}
            </time>
          </p>
        ) : (
          <p className="text-xs text-gray-500">Soubor zatím neexistuje.</p>
        )}
      </header>

      {loadError && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {loadError}
        </div>
      )}

      <LokaceHierarchieEditor
        initialHierarchy={hierarchy}
        locations={locations}
      />
    </div>
  );
}
