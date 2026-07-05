/**
 * Minimal typings for `piexifjs` (the package ships no types). We only use
 * load / dump / insert plus the IFD tag-name maps, so the surface here is
 * deliberately small. Values are `unknown` because EXIF tags carry a mix of
 * strings, numbers and rational tuples ([num, den] / [[num, den], …]).
 */
declare module "piexifjs" {
  type Ifd = Record<number, unknown>;
  interface ExifDict {
    "0th": Ifd;
    Exif: Ifd;
    GPS: Ifd;
    Interop?: Ifd;
    "1st"?: Ifd;
    thumbnail?: string | null;
  }
  const piexif: {
    /** Parse EXIF from a JPEG passed as a binary string (latin1). */
    load(jpegBinaryString: string): ExifDict;
    /** Serialise an EXIF dict to a binary string suitable for `insert`. */
    dump(dict: Partial<ExifDict>): string;
    /** Insert EXIF bytes into a JPEG (binary string or data URL); returns
     *  the same shape it was given. */
    insert(exifBytes: string, jpeg: string): string;
    remove(jpeg: string): string;
    // Only the tags the re-crop path reads/writes are typed as definite
    // numbers (so `noUncheckedIndexedAccess` doesn't widen them to
    // `number | undefined` at the use sites); the rest stay indexable.
    ImageIFD: { Orientation: number; DateTime: number } & Record<string, number>;
    ExifIFD: {
      DateTimeOriginal: number;
      DateTimeDigitized: number;
      OffsetTime: number;
      OffsetTimeOriginal: number;
      SubSecTimeOriginal: number;
    } & Record<string, number>;
    GPSIFD: Record<string, number>;
  };
  export default piexif;
}
