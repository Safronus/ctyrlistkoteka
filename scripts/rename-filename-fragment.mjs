#!/usr/bin/env node
// Bulk-rename a fragment in filenames across one or more directories.
//
// Why a separate file from scripts/fix-zlin-rename.mjs: that one is
// a single-purpose maps-directory PREFIX rename (ZLíN_ → ZLÍN_).
// This one is general — substring match anywhere in the filename,
// any (from, to) pair, multiple directories at once. Both stay for
// posterity; the older one's behaviour is unchanged.
//
// Default targets: data/finds/ + data/crops/. Override with --dir
// for one-off use against a different subtree.
//
// Safety:
//   * dry-run by default — pass --apply to actually rename
//   * NFC-normalises both the search fragment and disk names before
//     comparing, so the script finds matches even on Mac-from-rsync
//     NFD filenames
//   * collision check: refuses to rename if the target name already
//     exists at the destination
//   * single readdir + sequential rename per dir — no race with
//     concurrent admin actions
//
// Usage:
//
//   # Dry-run (just lists what would change)
//   node scripts/rename-filename-fragment.mjs "ZLíN" "ZLÍN"
//
//   # Apply
//   node scripts/rename-filename-fragment.mjs "ZLíN" "ZLÍN" --apply
//
//   # Different directory pair
//   node scripts/rename-filename-fragment.mjs "FOO" "BAR" \
//     --dir /var/ctyrlistkoteka/data/maps \
//     --apply
//
// Remember to run `pnpm sync` afterwards so find_images.original_filename
// + location_maps.original_filename in the DB pick up the new names.

import { promises as fs } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const positional = argv.filter((a) => !a.startsWith("--"));

const fromArg = positional[0];
const toArg = positional[1];
if (!fromArg || !toArg) {
  console.error(
    'Usage: node scripts/rename-filename-fragment.mjs "from" "to" [--apply] [--dir <path>]',
  );
  process.exit(1);
}

const FROM = fromArg.normalize("NFC");
const TO = toArg.normalize("NFC");

// Default to the production data directories. --dir overrides BOTH
// (so a single --dir means "scan only this one dir"). For more than
// one custom dir, pass --dir multiple times.
const dirFlags = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--dir" && argv[i + 1]) {
    dirFlags.push(argv[i + 1]);
    i++;
  }
}
const DATA_DIR = process.env.DATA_DIR ?? "/var/ctyrlistkoteka/data";
const dirs =
  dirFlags.length > 0
    ? dirFlags
    : [path.join(DATA_DIR, "finds"), path.join(DATA_DIR, "crops")];

console.log(`mode    : ${apply ? "APPLY" : "DRY-RUN (no changes)"}`);
console.log(`from    : "${FROM}"`);
console.log(`to      : "${TO}"`);
console.log(`dirs    : ${dirs.join(", ")}`);
console.log("");

let totalMatched = 0;
let totalRenamed = 0;
let totalSkipped = 0;

for (const dir of dirs) {
  console.log(`=== ${dir} ===`);
  let names;
  try {
    names = await fs.readdir(dir);
  } catch (err) {
    if (err.code === "ENOENT") {
      console.log("  (directory missing — skipping)");
      continue;
    }
    throw err;
  }
  let dirMatched = 0;
  let dirRenamed = 0;
  let dirSkipped = 0;
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const nfc = name.normalize("NFC");
    if (!nfc.includes(FROM)) continue;
    dirMatched++;
    totalMatched++;
    const newNfc = nfc.split(FROM).join(TO);
    if (newNfc === nfc) {
      // Defensive — shouldn't happen given the includes() above, but
      // a paranoid skip avoids ever fs.rename'ing same → same.
      continue;
    }
    const oldPath = path.join(dir, name);
    const newPath = path.join(dir, newNfc);
    // Collision check: refuses to overwrite an existing target.
    let collides = false;
    try {
      await fs.access(newPath);
      collides = true;
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
    if (collides) {
      console.warn(`  ⚠ SKIP collision  ${name}  →  ${newNfc}`);
      dirSkipped++;
      totalSkipped++;
      continue;
    }
    if (apply) {
      await fs.rename(oldPath, newPath);
      console.log(`  ✓ renamed  ${name}  →  ${newNfc}`);
      dirRenamed++;
      totalRenamed++;
    } else {
      console.log(`  → would rename  ${name}  →  ${newNfc}`);
    }
  }
  console.log(
    `  ${dirMatched} matched, ${apply ? `${dirRenamed} renamed` : "0 renamed (dry-run)"}, ${dirSkipped} skipped`,
  );
}

console.log("");
console.log(
  `summary: ${totalMatched} matched, ${apply ? `${totalRenamed} renamed` : "0 renamed (dry-run — pass --apply to commit)"}, ${totalSkipped} skipped`,
);
if (apply && totalRenamed > 0) {
  console.log("");
  console.log("⚠ Remember to run `pnpm sync` so the DB picks up the new filenames.");
}
