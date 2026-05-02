/** Magic-byte signature checks for the image formats the admin layer
 *  accepts. Used by donation/location photo uploads to reject files
 *  that have a recognised extension but corrupt or wrong-format bytes
 *  (e.g. a renamed text file). The find/crops/maps actions keep their
 *  inline copies — touching those is out of scope for phase 6. */

export function looksLikeJpeg(buf: Uint8Array): boolean {
  return (
    buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
  );
}

export function looksLikePng(buf: Uint8Array): boolean {
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

export function looksLikeWebp(buf: Uint8Array): boolean {
  // RIFF....WEBP — bytes 0..3 are "RIFF", 8..11 are "WEBP".
  return (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  );
}

/** Validates `buf` against the magic bytes of the format implied by
 *  the lowercase extension (no dot). Returns null on match, an error
 *  string otherwise. PNG accepts JPEG bytes too — legacy maps from
 *  Map Marker arrive as JPEG bytes wearing a .png suffix. */
export function checkImageMagic(
  ext: string,
  buf: Uint8Array,
): string | null {
  const e = ext.toLowerCase();
  if (e === "jpg" || e === "jpeg") {
    return looksLikeJpeg(buf) ? null : "Soubor nezačíná JPEG signaturou (FF D8 FF)";
  }
  if (e === "png") {
    return looksLikePng(buf) || looksLikeJpeg(buf)
      ? null
      : "Soubor nezačíná PNG ani JPEG signaturou";
  }
  if (e === "webp") {
    return looksLikeWebp(buf) ? null : "Soubor nezačíná WEBP signaturou (RIFF…WEBP)";
  }
  return `Nepodporovaná přípona: ".${ext}"`;
}
