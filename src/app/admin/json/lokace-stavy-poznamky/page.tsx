import Link from "next/link";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ArrowLeft } from "lucide-react";
import { ensureAdminAuth } from "@/lib/admin/guard";
import { LOKACE_STAVY_POZNAMKY_FILENAME } from "@/lib/admin/jsonSchema";
import { ADMIN_ROOTS } from "@/lib/admin/paths";
import { LokaceStavyPoznamkyEditor } from "./editor";

export const dynamic = "force-dynamic";

const TARGET_PATH = path.join(
  ADMIN_ROOTS.meta,
  LOKACE_STAVY_POZNAMKY_FILENAME,
);

const EMPTY_TEMPLATE = JSON.stringify(
  {
    anonymizace: { ANONYMIZOVANE: [] },
    lokace: {},
    poznamky: {},
    stavy: {
      BEZFOTKY: [],
      BEZGPS: [],
      BEZLOKACE: [],
      DAROVANY: [],
      "LOKACE-NEEXISTUJE": [],
      NEUTRZEN: [],
      ZTRACENY: [],
    },
  },
  null,
  2,
) + "\n";

export default async function LokaceStavyPoznamkyPage() {
  await ensureAdminAuth();

  // Read the live file at request time. force-dynamic + the
  // revalidatePath calls inside the save action make the editor
  // pick up server-side edits without a manual reload.
  let content: string;
  let mtimeIso: string | null;
  try {
    content = await fs.readFile(TARGET_PATH, "utf8");
    const stat = await fs.stat(TARGET_PATH);
    mtimeIso = stat.mtime.toISOString();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // First-run scaffold so the editor doesn't blow up on an
      // empty input. The user can save this skeleton as-is to
      // create the file.
      content = EMPTY_TEMPLATE;
      mtimeIso = null;
    } else {
      throw err;
    }
  }

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
          Editor validuje strukturu i syntaxi range stringů (např.{" "}
          <code className="font-mono">&quot;15-35&quot;</code>).
        </p>
      </header>

      <LokaceStavyPoznamkyEditor
        initialContent={content}
        fileMtime={mtimeIso}
      />
    </div>
  );
}
