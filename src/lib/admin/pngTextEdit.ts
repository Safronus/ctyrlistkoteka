import { normalizeKey } from "@/lib/images";

/**
 * In-place edits of PNG textual metadata chunks (tEXt / iTXt).
 *
 * Why both chunk types: real-world tools we round-trip through use
 * either flavour interchangeably — Map Marker writes tEXt, exiftool
 * sometimes copies it as iTXt. Removal therefore matches BOTH chunk
 * types by normalised keyword (same normalisation pipeline as
 * `readAnonymizedFlag` in images.ts), so toggling off the
 * "Anonymizovaná lokace" tag works regardless of how the original
 * tool encoded it.
 *
 * Insertion uses tEXt because the keywords we care about all fit in
 * the Latin-1 subset PNG tEXt requires (`á` = 0xE1 is in [161–255]).
 * Placing the new chunk just before IEND is safe — the spec lets
 * ancillary chunks appear anywhere except inside IDAT runs.
 *
 * CRC32 is computed over `type + data` per the PNG spec (ISO/IEC
 * 15948-1) using the IEEE 802.3 polynomial. We compute it manually
 * rather than reach for `zlib.crc32` so the helper compiles on Node
 * versions older than 22.2 too.
 */

/** Builds a CRC-32 lookup table once at module load. ~1 KB; cached
 *  for hot-path use across many edits. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = (CRC_TABLE[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function isPngSignature(buf: Buffer): boolean {
  return (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  );
}

interface ChunkRef {
  /** Chunk type code (4 ASCII chars). */
  type: string;
  /** The chunk as it sits in the file: length(4) + type(4) + data + crc(4). */
  raw: Buffer;
}

function parseChunks(buf: Buffer): ChunkRef[] {
  const chunks: ChunkRef[] = [];
  let off = 8;
  while (off + 12 <= buf.length) {
    const length = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8).toString("ascii");
    const dataEnd = off + 8 + length;
    if (dataEnd + 4 > buf.length) break;
    chunks.push({ type, raw: buf.subarray(off, dataEnd + 4) });
    off = dataEnd + 4;
    if (type === "IEND") break;
  }
  return chunks;
}

function chunkKeyword(chunk: ChunkRef): string | null {
  if (chunk.type !== "tEXt" && chunk.type !== "iTXt") return null;
  const length = chunk.raw.readUInt32BE(0);
  const data = chunk.raw.subarray(8, 8 + length);
  const sep = data.indexOf(0);
  if (sep <= 0) return null;
  // Both tEXt and iTXt store the keyword as Latin-1 up to the first
  // null. The fields after the null differ but we only need the key.
  return data.subarray(0, sep).toString("latin1");
}

/** Builds a new tEXt chunk for `keyword=value`. PNG spec lets keyword
 *  bytes be Latin-1 printable [33,126] ∪ [161,255]; we don't enforce
 *  that here because every keyword we use ("Anonymizovaná lokace") is
 *  already valid. Caller is the only producer of keyword strings. */
function buildTextChunk(keyword: string, value: string): Buffer {
  const keywordBuf = Buffer.from(keyword, "latin1");
  const valueBuf = Buffer.from(value, "latin1");
  const data = Buffer.concat([keywordBuf, Buffer.from([0]), valueBuf]);
  const typeBuf = Buffer.from("tEXt", "ascii");
  const out = Buffer.allocUnsafe(4 + 4 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  typeBuf.copy(out, 4);
  data.copy(out, 8);
  const crc = crc32(Buffer.concat([typeBuf, data]));
  out.writeUInt32BE(crc, 8 + data.length);
  return out;
}

export interface PngTextEditResult {
  buffer: Buffer;
  /** Number of matching chunks (tEXt + iTXt) that were dropped. */
  removed: number;
  /** 1 when a new chunk was inserted, 0 otherwise. */
  added: 0 | 1;
}

/** Sets (replaces existing matching chunks then appends) a tEXt
 *  metadata tag. When `value === null`, just removes any matching
 *  chunks — no new chunk is added. Matching is by normalised keyword
 *  so "AnonymizovanLokace" and "Anonymizovaná lokace" hit the same
 *  bucket. The new chunk goes in just before IEND. */
export function setPngTextTag(
  buf: Buffer,
  keyword: string,
  value: string | null,
): PngTextEditResult {
  if (!isPngSignature(buf)) {
    throw new Error("Vstupní soubor není PNG (chybí signature)");
  }
  const chunks = parseChunks(buf);
  const target = normalizeKey(keyword);

  let removed = 0;
  const kept: Buffer[] = [];
  for (const c of chunks) {
    if (c.type === "tEXt" || c.type === "iTXt") {
      const kw = chunkKeyword(c);
      if (kw !== null && normalizeKey(kw) === target) {
        removed += 1;
        continue;
      }
    }
    kept.push(c.raw);
  }

  let added: 0 | 1 = 0;
  if (value !== null) {
    const newChunk = buildTextChunk(keyword, value);
    // Splice in just before IEND so the structural ordering stays
    // valid (PNG decoders don't care about ancillary order, but a
    // strict reader would still expect IEND last).
    const iendIdx = kept.findIndex(
      (c) => c.subarray(4, 8).toString("ascii") === "IEND",
    );
    if (iendIdx === -1) kept.push(newChunk);
    else kept.splice(iendIdx, 0, newChunk);
    added = 1;
  }

  return {
    buffer: Buffer.concat([buf.subarray(0, 8), ...kept]),
    removed,
    added,
  };
}
