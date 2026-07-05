/**
 * Merge CZ→EN translations into the note/caption override stores.
 *
 *   pnpm tsx scripts/import-note-translations.ts translated.json
 *
 * `translated.json` shape (as produced from the export):
 *   {
 *     "finds": { "16230": "English note", … },
 *     "maps":  { "55":    "English caption", … }
 *   }
 *
 * Sets ONLY the `en` variant per id — the `cs` side is left as-is (an
 * existing CS override is preserved; where there is none, the public CS
 * keeps tracking the filename / LSP-JSON source). Writes are read-modify-
 * write and atomic, so existing overrides are merged, not clobbered.
 *
 * The ids are expected to come from `export-notes-for-translation.ts`, which
 * already excludes anonymized/donated finds and anonymized maps — this
 * script trusts that filtering.
 */

import { readFile } from "node:fs/promises";
import {
  getFindNoteOverride,
  writeFindNoteOverride,
} from "../src/lib/findNoteOverrides";
import {
  getMapNoteOverride,
  writeMapNoteOverride,
} from "../src/lib/mapNoteOverrides";

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error(
      "usage: pnpm tsx scripts/import-note-translations.ts <translated.json>",
    );
    process.exit(1);
  }
  const data = JSON.parse(await readFile(path, "utf8")) as {
    finds?: Record<string, string>;
    maps?: Record<string, string>;
  };

  let nf = 0;
  for (const [k, en] of Object.entries(data.finds ?? {})) {
    const id = Number(k);
    if (!Number.isInteger(id) || typeof en !== "string" || !en.trim()) continue;
    const existing = await getFindNoteOverride(id);
    await writeFindNoteOverride(id, { cs: existing?.cs, en });
    nf++;
  }

  let nm = 0;
  for (const [k, en] of Object.entries(data.maps ?? {})) {
    const id = Number(k);
    if (!Number.isInteger(id) || typeof en !== "string" || !en.trim()) continue;
    const existing = await getMapNoteOverride(id);
    await writeMapNoteOverride(id, { cs: existing?.cs, en });
    nm++;
  }

  console.error(`imported EN → finds: ${nf}, maps: ${nm}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
