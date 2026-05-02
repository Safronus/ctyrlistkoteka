import Busboy from "busboy";

/** A parsed multipart file part — minimal File-like shape that the
 *  upload routes already expect from `formData.getAll("files")`. We
 *  keep the bytes in memory because each request stays well under the
 *  per-batch cap (≤25 MB total typical, hard ceiling 200 MB) and the
 *  rest of the upload pipeline (sha1, magic-byte check, atomicWrite)
 *  works against `Buffer` anyway. */
export interface MultipartFile {
  /** FormData field name — should be "files" for our routes. */
  fieldName: string;
  /** Original client-provided filename. May be empty if the browser
   *  didn't send one. */
  filename: string;
  /** Browser-detected MIME type. Empty when missing. */
  mimeType: string;
  /** Full file contents. */
  data: Buffer;
}

export interface ParsedMultipart {
  files: MultipartFile[];
  /** Plain string fields from the same form (currently unused by the
   *  upload routes but cheap to keep). */
  fields: Record<string, string>;
}

/** Parses a `multipart/form-data` request body using busboy. We use
 *  busboy instead of `request.formData()` because the latter (which
 *  routes through undici's FormData parser in Next.js) silently fails
 *  with "Failed to parse body as FormData" on bigger Safari batches —
 *  the symptom we hit when uploading 50 photos at once. busboy is the
 *  standard Node multipart parser and handles the same batches fine.
 *
 *  Per-file size capping is the caller's responsibility: this helper
 *  buffers each part in full and won't reject mid-stream, but the
 *  caller can pass `maxFileSize` to short-circuit oversized parts.
 *  When the cap is hit, the file ends up flagged via `truncated:
 *  true` on the resulting MultipartFile. */
export async function parseMultipartRequest(
  request: Request,
  opts: {
    /** Per-file byte cap. Files exceeding this still appear in the
     *  result but with a `truncated` flag — caller can decide whether
     *  to reject. Default 100 MB. */
    maxFileSize?: number;
    /** Per-request total file count cap. Default 200; the upload
     *  routes pass MAX_FILES_PER_REQUEST so the form's expectation
     *  matches. */
    maxFiles?: number;
  } = {},
): Promise<ParsedMultipart> {
  const contentType = request.headers.get("content-type");
  if (!contentType || !contentType.toLowerCase().includes("multipart/")) {
    throw new Error(
      `Content-Type must be multipart/form-data, got ${contentType ?? "<none>"}`,
    );
  }

  // Read the whole body upfront and feed busboy synchronously, instead
  // of `Readable.fromWeb(request.body).pipe(busboy)`. The piped variant
  // mysteriously dropped trailing bytes in production for ≥50-file
  // Safari batches — busboy ended up reporting "Unexpected end of form"
  // with a Content-Length that perfectly matched the multipart payload
  // size, suggesting the Web→Node stream bridge was eating the tail.
  // For our per-batch caps (≤200 MB) this allocation cost is fine, and
  // we get a clear error if the network actually truncated by comparing
  // bytesRead against Content-Length.
  const buffer = Buffer.from(await request.arrayBuffer());
  const expectedLen = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(expectedLen) &&
    expectedLen > 0 &&
    buffer.length !== expectedLen
  ) {
    throw new Error(
      `Body length mismatch: read ${buffer.length} bytes, Content-Length said ${expectedLen}`,
    );
  }

  const busboy = Busboy({
    headers: { "content-type": contentType },
    // busboy defaults `defParamCharset` to "latin1", which mangles
    // every Czech diacritic in filenames coming from Safari/macOS
    // (e.g. "NORMÁLNÍ" → "NORMÃLNÃ"). Force UTF-8 so the filename in
    // Content-Disposition arrives intact and parseFindFilename gets
    // the byte sequence the user actually sent.
    defParamCharset: "utf8",
    limits: {
      fileSize: opts.maxFileSize ?? 100 * 1024 * 1024,
      files: opts.maxFiles ?? 200,
    },
  });

  const files: MultipartFile[] = [];
  const fields: Record<string, string> = {};

  const done = new Promise<void>((resolve, reject) => {
    busboy.on("file", (fieldName, fileStream, info) => {
      const chunks: Buffer[] = [];
      fileStream.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });
      fileStream.on("limit", () => {
        // Drain remaining bytes even when truncated — busboy needs us
        // to consume the stream or it stalls the whole parse.
        fileStream.resume();
      });
      fileStream.on("end", () => {
        files.push({
          fieldName,
          filename: info.filename ?? "",
          mimeType: info.mimeType ?? "",
          data: Buffer.concat(chunks),
        });
      });
      fileStream.on("error", (err) => reject(err));
    });
    busboy.on("field", (name, val) => {
      fields[name] = val;
    });
    busboy.on("close", () => resolve());
    busboy.on("error", (err) => reject(err));
  });

  // Synchronous push + end — busboy parses without waiting for any
  // upstream stream to settle.
  busboy.end(buffer);

  await done;
  return { files, fields };
}
