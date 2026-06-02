import Link from "next/link";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ArrowLeft } from "lucide-react";
import { ensureAdminAuth } from "@/lib/admin/guard";
import { formatJsonCompactArrays } from "@/lib/admin/jsonFormat";
import {
  LOKACE_STAVY_POZNAMKY_FILENAME,
  lokaceStavyPoznamkySchema,
  SECTION_KEYS,
  type SectionKey,
} from "@/lib/admin/jsonSchema";
import { listBackups } from "@/lib/admin/lspBackups";
import { ADMIN_ROOTS } from "@/lib/admin/paths";
import { BackupsPanel } from "./backups-panel";
import { EditorMergeLayout } from "./editor-merge-layout";
import { findInconsistencies, type JsonInconsistencies } from "./inconsistencies";

export const dynamic = "force-dynamic";

const TARGET_PATH = path.join(
  ADMIN_ROOTS.meta,
  LOKACE_STAVY_POZNAMKY_FILENAME,
);

const EMPTY_SECTIONS: Record<SectionKey, unknown> = {
  lokace: {},
  stavy: {
    BEZFOTKY: [],
    BEZGPS: [],
    BEZLOKACE: [],
    DAROVANY: [],
    "LOKACE-NEEXISTUJE": [],
    NEUTRZEN: [],
    ZTRACENY: [],
  },
  poznamky: {},
  anonymizace: { ANONYMIZOVANE: [] },
};

function pretty(value: unknown): string {
  return formatJsonCompactArrays(value);
}

/** Splits the live JSON file into per-section strings for the editor.
 *  Falls back to an empty skeleton when the file doesn't exist or
 *  isn't parseable — the user can fix the latter via the section
 *  textareas (each section validates independently, so a busted
 *  `lokace` block doesn't take down editing of the other three). */
async function loadSections(): Promise<{
  sections: Record<SectionKey, string>;
  mtimeIso: string | null;
  loadError: string | null;
  /** Inconsistency checks across the file — multi-location finds +
   *  duplicate poznamky keys. Null when the file is missing/broken
   *  enough that the checks can't run (panel hides in that case). */
  inconsistencies: JsonInconsistencies | null;
}> {
  let raw: string;
  let mtimeIso: string | null;
  try {
    raw = await fs.readFile(TARGET_PATH, "utf8");
    const stat = await fs.stat(TARGET_PATH);
    mtimeIso = stat.mtime.toISOString();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      const empty: Record<SectionKey, string> = {
        lokace: pretty(EMPTY_SECTIONS.lokace),
        stavy: pretty(EMPTY_SECTIONS.stavy),
        poznamky: pretty(EMPTY_SECTIONS.poznamky),
        anonymizace: pretty(EMPTY_SECTIONS.anonymizace),
      };
      return {
        sections: empty,
        mtimeIso: null,
        loadError: null,
        inconsistencies: null,
      };
    }
    throw err;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    // Parse failure: hand the user the raw bytes split as best we
    // can. A wholly broken file blocks the editor and that's worse
    // than letting them see the raw content.
    const sections: Record<SectionKey, string> = {
      lokace: pretty(EMPTY_SECTIONS.lokace),
      stavy: pretty(EMPTY_SECTIONS.stavy),
      poznamky: pretty(EMPTY_SECTIONS.poznamky),
      anonymizace: pretty(EMPTY_SECTIONS.anonymizace),
    };
    return {
      sections,
      mtimeIso,
      loadError:
        err instanceof Error
          ? `Soubor neparsuje jako JSON: ${err.message}. Editor startuje s prázdnými sekcemi — zkontroluj/uprav, pak ulož.`
          : "Soubor neparsuje jako JSON",
      inconsistencies: null,
    };
  }

  const sections: Record<SectionKey, string> = {
    lokace: pretty(parsed.lokace ?? EMPTY_SECTIONS.lokace),
    stavy: pretty(parsed.stavy ?? EMPTY_SECTIONS.stavy),
    poznamky: pretty(parsed.poznamky ?? EMPTY_SECTIONS.poznamky),
    anonymizace: pretty(parsed.anonymizace ?? EMPTY_SECTIONS.anonymizace),
  };

  // Sanity check — if the file has top-level keys we don't recognise,
  // surface a hint in the page header so the user knows their data
  // isn't being silently dropped on save.
  const known = new Set<string>(SECTION_KEYS);
  const unknownKeys = Object.keys(parsed).filter((k) => !known.has(k));
  const loadError =
    unknownKeys.length > 0
      ? `Pozor: ze souboru se nepřevedly tyto klíče (editor je ignoruje): ${unknownKeys.join(", ")}`
      : null;

  // Inconsistency checks. Only run when the parsed JSON satisfies the
  // full schema — otherwise the helpers would have to defensively
  // crawl unknown shapes, and any inconsistencies they'd report would
  // be drowned out by the structural errors the editor already
  // surfaces section by section. The raw text is passed so the
  // duplicate-poznamky check can catch keys JSON.parse would have
  // silently collapsed.
  const validated = lokaceStavyPoznamkySchema.safeParse(parsed);
  const inconsistencies: JsonInconsistencies | null = validated.success
    ? findInconsistencies(validated.data, raw)
    : null;

  return { sections, mtimeIso, loadError, inconsistencies };
}

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Optional `?tab=` URL param lets deep-links land on a specific
 *  section (lokace / stavy / poznamky / anonymizace). Used by
 *  /admin/checks rows that surface JSON-vs-filename mismatches so
 *  the operator opens straight on the offending sub-section
 *  instead of clicking around. Unknown values fall back to "lokace"
 *  (the editor's own default), so a stale link from older code
 *  doesn't break navigation. */
function parseInitialTab(raw: string | undefined): SectionKey | undefined {
  if (!raw) return undefined;
  return (SECTION_KEYS as readonly string[]).includes(raw)
    ? (raw as SectionKey)
    : undefined;
}

export default async function LokaceStavyPoznamkyPage({
  searchParams,
}: PageProps) {
  await ensureAdminAuth();
  const sp = await searchParams;
  const rawTab = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const initialTab = parseInitialTab(rawTab);
  const { sections, mtimeIso, loadError, inconsistencies } =
    await loadSections();
  const backups = await listBackups();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 hover:text-gray-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Přehled
        </Link>
        <span aria-hidden>/</span>
        <span className="text-gray-900">
          JSON editor — LokaceStavyPoznamky
        </span>
      </div>

      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-gray-900">
          LokaceStavyPoznamky.json
        </h1>
        <p className="text-sm text-gray-500">
          Autoritativní mapování lokalita → nálezy, stavy, poznámky a
          anonymizace. Slouží jako zdroj pravdy pro <code>sync.ts</code>.
          Editor je rozdělen na 4 nezávislé sekce — každá validuje strukturu
          a syntaxi range stringů (např.{" "}
          <code className="font-mono">&quot;15-35&quot;</code>) zvlášť.
        </p>
      </header>

      {loadError && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {loadError}
        </p>
      )}

      {/* `key={mtimeIso}` on the layout forces a clean remount of
          BOTH the editor and the merge form whenever the file is
          rewritten (save action OR merge form OR out-of-band CLI
          edit). Without this the editor's internal `sections`
          useState would freeze on first mount's initialSections and
          silently drift from disk after a merge — looking like "you
          have unsaved changes" when in reality the server has fresh
          state and the editor is the stale side. The shared
          `activeTab` state lifted into EditorMergeLayout lets the
          merge form's section toggles drive the editor's tab in
          one click. */}
      <EditorMergeLayout
        key={mtimeIso ?? "empty"}
        initialSections={sections}
        fileMtime={mtimeIso}
        initialTab={initialTab}
        inconsistencies={inconsistencies}
      />

      <BackupsPanel backups={backups} />
    </div>
  );
}
