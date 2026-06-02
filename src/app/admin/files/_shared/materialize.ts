/**
 * Reads each queued File's bytes into memory and stages them on a fresh
 * FormData as in-memory Blobs.
 *
 * Why: Safari can fail to read a `File` at request-send time when the
 * backing file on disk changed/moved/was regenerated after it was
 * selected in the picker. The symptom is the WHOLE multipart upload
 * failing with a generic fetch "Load failed" and no HTTP response —
 * exactly what bit the crop uploads for files that had been regenerated
 * between selection and upload. Reading the bytes here:
 *   1. gives Safari a fresh, fully in-memory Blob it can reliably send;
 *   2. turns a genuinely unreadable file into a clear PER-FILE error
 *      instead of nuking the entire batch.
 *
 * The returned `sent` array lists the items that were appended, in
 * append order — callers must map the server's index-keyed results
 * against THIS array (not the original batch), since unreadable items
 * are excluded from the request.
 */
export interface MaterializeResult<T> {
  fd: FormData;
  /** Items whose bytes were read and appended to `fd`, in append order. */
  sent: T[];
  /** Items that couldn't be read from disk, each with a reason to show. */
  unreadable: { item: T; reason: string }[];
}

const REASON_EMPTY = "Soubor je prázdný nebo nečitelný z disku.";
const REASON_UNREADABLE =
  "Soubor se nepodařilo přečíst z disku — možná byl po výběru přesunut nebo přegenerován. Vyber ho znovu a zkus to.";

export async function materializeUploadBatch<T extends { file: File }>(
  batch: readonly T[],
): Promise<MaterializeResult<T>> {
  const fd = new FormData();
  const sent: T[] = [];
  const unreadable: { item: T; reason: string }[] = [];

  for (const item of batch) {
    try {
      const buf = await item.file.arrayBuffer();
      if (buf.byteLength === 0) {
        unreadable.push({ item, reason: REASON_EMPTY });
        continue;
      }
      fd.append(
        "files",
        new Blob([buf], {
          type: item.file.type || "application/octet-stream",
        }),
        item.file.name,
      );
      sent.push(item);
    } catch {
      unreadable.push({ item, reason: REASON_UNREADABLE });
    }
  }

  return { fd, sent, unreadable };
}
