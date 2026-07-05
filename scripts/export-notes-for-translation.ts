/**
 * Export Czech note/caption source texts for a CZ→EN translation pass.
 *
 *   pnpm tsx scripts/export-notes-for-translation.ts > to-translate.json
 *
 * Dumps the Czech source of every find note and location-map caption that
 * is shown on the public site but still LACKS an English override, so it
 * can be handed to a translator and merged back via
 * `scripts/import-note-translations.ts`.
 *
 * PRIVACY (CLAUDE.md §6): anonymized + donated finds and anonymized maps
 * are EXCLUDED — their notes are never shown publicly and must not leave
 * the server. Everything this prints is ALREADY public on the website.
 *
 * Output (stdout):
 *   {
 *     "finds": [ { "id": 16230, "cs": "…" }, … ],
 *     "maps":  [ { "id": 55,    "cs": "…" }, … ]
 *   }
 * Counts go to stderr. Entries that already have an EN override are skipped
 * (so re-running after a partial import only surfaces what's left).
 */

import { FindState, PrismaClient } from "@prisma/client";
import { readFindNoteOverrides } from "../src/lib/findNoteOverrides";
import { readMapNoteOverrides } from "../src/lib/mapNoteOverrides";

async function main() {
  const prisma = new PrismaClient();
  try {
    const [findOverrides, mapOverrides] = await Promise.all([
      readFindNoteOverrides(),
      readMapNoteOverrides(),
    ]);

    // Finds — public note = override.cs || notes. Match the find-detail
    // note gate: non-anonymized AND not donated. Only rows with a CS source
    // and no EN override yet.
    const findRows = await prisma.find.findMany({
      where: {
        isAnonymized: false,
        states: { none: { state: FindState.DONATED } },
      },
      select: { id: true, notes: true },
      orderBy: { id: "asc" },
    });
    const finds: { id: number; cs: string }[] = [];
    for (const r of findRows) {
      const ov = findOverrides.get(r.id);
      if (ov?.en) continue; // already translated
      const cs = (ov?.cs ?? r.notes ?? "").trim();
      if (cs) finds.push({ id: r.id, cs });
    }

    // Maps — public caption = override.cs || description. Non-anonymized
    // maps only, same "no EN override yet" filter.
    const mapRows = await prisma.locationMap.findMany({
      where: { isAnonymized: false },
      select: { id: true, description: true },
      orderBy: { id: "asc" },
    });
    const maps: { id: number; cs: string }[] = [];
    for (const r of mapRows) {
      const ov = mapOverrides.get(r.id);
      if (ov?.en) continue;
      const cs = (ov?.cs ?? r.description ?? "").trim();
      if (cs) maps.push({ id: r.id, cs });
    }

    process.stderr.write(
      `to translate → finds: ${finds.length}, maps: ${maps.length}\n`,
    );
    process.stdout.write(`${JSON.stringify({ finds, maps }, null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
