import { Readable } from "node:stream";
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

  const body = request.body;
  if (!body) throw new Error("Request body is empty");

  const busboy = Busboy({
    headers: { "content-type": contentType },
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

  // ReadableStream<Uint8Array> from `request.body` → Node Readable so
  // busboy can pipe-style consume it. Node 20+ provides Readable.fromWeb
  // for this exact purpose.
  Readable.fromWeb(body as never).pipe(busboy);

  await done;
  return { files, fields };
}
