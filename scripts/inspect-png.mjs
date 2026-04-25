#!/usr/bin/env node
// Diagnostic: dumps all PNG chunks of one map file, including text from
// tEXt / iTXt (compressed too) / zTXt, plus a raw grep for the
// AnonymizovanLokace string. Use this to find which chunk type our
// metadata tag is actually written into.
//
// Usage:
//   node scripts/inspect-png.mjs <path-to-map.png>
//   node scripts/inspect-png.mjs --scan <dir>
//
// In --scan mode, walks every *.png in the dir, reports which contain
// the literal "AnonymizovanLokace" in raw bytes, and dumps chunk detail
// of the first hit.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { join } from "node:path";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error(
    "usage: node scripts/inspect-png.mjs <path-to-png>\n" +
      "       node scripts/inspect-png.mjs --scan <dir>",
  );
  process.exit(2);
}

let target;
if (args[0] === "--scan") {
  const dir = args[1];
  if (!dir) {
    console.error("--scan needs a directory");
    process.exit(2);
  }
  const files = readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".png"))
    .map((f) => join(dir, f))
    .filter((p) => statSync(p).isFile());
  console.log(`scanning ${files.length} PNG files in ${dir}`);
  const needle = Buffer.from("AnonymizovanLokace", "utf8");
  const hits = [];
  for (const p of files) {
    const b = readFileSync(p);
    if (b.indexOf(needle) >= 0) hits.push(p);
  }
  console.log(`hits with raw "AnonymizovanLokace": ${hits.length}`);
  for (const h of hits.slice(0, 10)) console.log(`  ${h}`);
  if (hits.length === 0) {
    console.log(
      '\nString not found raw in any PNG → tag is compressed (likely XMP in compressed iTXt or zTXt). Picking first PNG to inspect chunk types.',
    );
    target = files[0];
  } else {
    target = hits[0];
    console.log(`\nDumping chunks of: ${target}`);
  }
} else {
  target = args[0];
}

const buf = readFileSync(target);
console.log(`file: ${target} size=${buf.length}`);

const sig = buf.subarray(0, 8);
if (
  sig[0] !== 0x89 ||
  sig[1] !== 0x50 ||
  sig[2] !== 0x4e ||
  sig[3] !== 0x47
) {
  console.error("not a PNG (bad signature)");
  process.exit(1);
}

let off = 8;
const counts = {};
while (off + 12 <= buf.length) {
  const len = buf.readUInt32BE(off);
  const type = buf.subarray(off + 4, off + 8).toString("ascii");
  const data = buf.subarray(off + 8, off + 8 + len);
  counts[type] = (counts[type] ?? 0) + 1;
  console.log(`\nchunk ${type} length=${len}`);

  if (type === "tEXt") {
    const sep = data.indexOf(0);
    if (sep > 0) {
      const k = data.subarray(0, sep).toString("latin1");
      const v = data.subarray(sep + 1).toString("utf8");
      console.log(`  tEXt keyword=${JSON.stringify(k)}`);
      console.log(`  value=${JSON.stringify(v.slice(0, 400))}`);
    }
  } else if (type === "iTXt") {
    const sep1 = data.indexOf(0);
    if (sep1 > 0) {
      const keyword = data.subarray(0, sep1).toString("latin1");
      const compFlag = data[sep1 + 1] ?? 0;
      const compMethod = data[sep1 + 2] ?? 0;
      const sep2 = data.indexOf(0, sep1 + 3);
      const sep3 = sep2 >= 0 ? data.indexOf(0, sep2 + 1) : -1;
      const lang = sep2 >= 0 ? data.subarray(sep1 + 3, sep2).toString("ascii") : "";
      const tkw =
        sep3 >= 0 ? data.subarray(sep2 + 1, sep3).toString("utf8") : "";
      let payload = sep3 >= 0 ? data.subarray(sep3 + 1) : Buffer.alloc(0);
      let txt;
      if (compFlag === 1) {
        try {
          txt = inflateSync(payload).toString("utf8");
        } catch (e) {
          txt = `<inflate failed: ${e.message}>`;
        }
      } else {
        txt = payload.toString("utf8");
      }
      console.log(
        `  iTXt keyword=${JSON.stringify(keyword)} comp=${compFlag} method=${compMethod} lang=${JSON.stringify(lang)} translated=${JSON.stringify(tkw)}`,
      );
      console.log(`  value=${JSON.stringify(txt.slice(0, 1500))}`);
    }
  } else if (type === "zTXt") {
    const sep = data.indexOf(0);
    if (sep > 0) {
      const k = data.subarray(0, sep).toString("latin1");
      const compMethod = data[sep + 1] ?? 0;
      let txt;
      try {
        txt = inflateSync(data.subarray(sep + 2)).toString("utf8");
      } catch (e) {
        txt = `<inflate failed: ${e.message}>`;
      }
      console.log(`  zTXt keyword=${JSON.stringify(k)} method=${compMethod}`);
      console.log(`  value=${JSON.stringify(txt.slice(0, 1500))}`);
    }
  }

  if (type === "IEND") break;
  off += 12 + len;
}

console.log("\nchunk counts:", counts);

const idx = buf.indexOf(Buffer.from("AnonymizovanLokace", "utf8"));
console.log(
  idx >= 0
    ? `\nraw byte search: "AnonymizovanLokace" found at offset ${idx}`
    : `\nraw byte search: "AnonymizovanLokace" NOT FOUND in raw bytes (probably compressed)`,
);

// If raw not found, try inflating every iTXt/zTXt payload and grep there.
if (idx < 0) {
  console.log(
    "\nDecoding all compressed text chunks and re-searching for AnonymizovanLokace…",
  );
  let off2 = 8;
  while (off2 + 12 <= buf.length) {
    const len = buf.readUInt32BE(off2);
    const type = buf.subarray(off2 + 4, off2 + 8).toString("ascii");
    const data = buf.subarray(off2 + 8, off2 + 8 + len);
    if (type === "iTXt") {
      const sep1 = data.indexOf(0);
      if (sep1 > 0 && data[sep1 + 1] === 1) {
        const sep2 = data.indexOf(0, sep1 + 3);
        const sep3 = sep2 >= 0 ? data.indexOf(0, sep2 + 1) : -1;
        if (sep3 >= 0) {
          try {
            const txt = inflateSync(data.subarray(sep3 + 1)).toString("utf8");
            if (txt.includes("AnonymizovanLokace")) {
              console.log(
                `  HIT in compressed iTXt keyword=${data.subarray(0, sep1).toString("latin1")}`,
              );
              console.log(`  payload: ${JSON.stringify(txt.slice(0, 2000))}`);
            }
          } catch {}
        }
      }
    } else if (type === "zTXt") {
      const sep = data.indexOf(0);
      if (sep > 0) {
        try {
          const txt = inflateSync(data.subarray(sep + 2)).toString("utf8");
          if (txt.includes("AnonymizovanLokace")) {
            console.log(
              `  HIT in zTXt keyword=${data.subarray(0, sep).toString("latin1")}`,
            );
            console.log(`  payload: ${JSON.stringify(txt.slice(0, 2000))}`);
          }
        } catch {}
      }
    }
    if (type === "IEND") break;
    off2 += 12 + len;
  }
}
