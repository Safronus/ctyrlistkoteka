/**
 * Standalone WebP generator. Regenerates thumb+web variants for every file
 * in `${DATA_DIR}/finds/` and `${DATA_DIR}/crops/`. The sync script calls the
 * same helper inline; this entrypoint exists so the user can re-run just
 * image generation without touching the DB (e.g. after changing thumb size).
 *
 *   pnpm generate-images              # only missing outputs
 *   pnpm generate-images --force      # regenerate everything
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { generateWebPVariants } from "../src/lib/images";

async function listFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && !e.name.startsWith("."))
      .map((e) => e.name);
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "ENOENT"
    ) {
      return [];
    }
    throw err;
  }
}

async function main() {
  const force = process.argv.includes("--force");
  const dataDir = process.env.DATA_DIR ?? "./data";
  const generatedDir = process.env.GENERATED_DIR ?? "./public/generated";

  const subdirs: Array<{ path: string; label: string }> = [
    { path: join(dataDir, "finds"), label: "finds" },
    { path: join(dataDir, "crops"), label: "crops" },
  ];

  let total = 0;
  let generated = 0;
  let cached = 0;

  for (const { path, label } of subdirs) {
    const files = await listFiles(path);
    for (const f of files) {
      total += 1;
      const src = join(path, f);
      try {
        const r = await generateWebPVariants({
          sourcePath: src,
          generatedDir,
          forceRegen: force,
        });
        if (r.sourceFormat === "cached") {
          cached += 1;
          process.stdout.write(`· ${label}/${f} [cached]\n`);
        } else {
          generated += 1;
          process.stdout.write(
            `✓ ${label}/${f} [${r.sourceFormat}] → ${r.width}×${r.height}\n`,
          );
        }
      } catch (err: unknown) {
        process.stderr.write(
          `✗ ${label}/${f}: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    }
  }

  process.stdout.write(
    `\nDone. Total: ${total}, generated: ${generated}, cached: ${cached}\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
