#!/usr/bin/env node
// One-shot helper to rename map PNG files whose code starts with "ZLíN_"
// (lowercase í, U+00ED) to the correct "ZLÍN_" (uppercase Í, U+00CD).
//
// Why this lives here: the rename is needed on the VPS where the bash
// shell + Termius bracketed-paste mangled every multi-line attempt to
// run the same logic ad-hoc. Committed script avoids copy-paste.
//
// Usage: node scripts/fix-zlin-rename.mjs [--dir <maps-dir>]
// Default dir: /var/ctyrlistkoteka/data/maps

import { readdirSync, renameSync } from "node:fs";
import { join } from "node:path";

const dirIdx = process.argv.indexOf("--dir");
const dir =
  dirIdx >= 0 && process.argv[dirIdx + 1]
    ? process.argv[dirIdx + 1]
    : "/var/ctyrlistkoteka/data/maps";

const OLD = "ZLíN_"; // ZLíN_  (lowercase, NFC)
const NEW = "ZLÍN_"; // ZLÍN_  (uppercase, NFC)

const all = readdirSync(dir);
const targets = all.filter((f) => f.startsWith(OLD));

console.log(`scanning: ${dir}`);
console.log(`matches : ${targets.length}`);
for (const f of targets) {
  const t = NEW + f.slice(OLD.length);
  console.log(`rename: ${f}`);
  console.log(`     -> ${t}`);
  renameSync(join(dir, f), join(dir, t));
}
console.log(`total renamed: ${targets.length}`);
