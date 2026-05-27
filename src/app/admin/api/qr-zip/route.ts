import archiver from "archiver";
import { NextResponse, type NextRequest } from "next/server";
import { appendAudit } from "@/lib/admin/audit";
import { renderFindQrSvg } from "@/lib/admin/qr";
import { parseFindFilename } from "@/lib/parseFilename";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Hard cap on the number of QR PNGs produced per request. Larger
 *  batches need more memory for the in-flight buffers (each PNG is
 *  ~30-80 kB at the QR card's natural size) and tie up sharp longer
 *  than a single-shot request should. Splitting a 500-find selection
 *  into two 250-find downloads is a fine UX. */
const MAX_QR_ZIP = 500;

/** POST /admin/api/qr-zip
 *
 *  Body: `multipart/form-data` with one or more `filename` fields
 *  (mirrors the bulk-delete shape so the client can reuse the same
 *  selection set). Each filename is parsed for its find ID via the
 *  existing parseFindFilename — invalid names are skipped silently
 *  rather than aborting the whole batch (the operator still gets
 *  whatever's valid).
 *
 *  Response: a streamed `application/zip` named `qr-codes.zip`
 *  containing one PNG per resolved find ID:
 *    ctyrlistek-<findId>.png
 *
 *  Sharp rasterises each SVG (librsvg-backed) at 2× density so the
 *  PNG print quality matches the per-find modal's PNG download. The
 *  whole pipeline streams through archiver — no monolithic buffer
 *  on the server, no temp files on disk. */
export async function POST(request: NextRequest): Promise<Response> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    return new NextResponse("Not found", { status: 404 });
  }
  const credentialLabel = session.credentialLabel!;
  const ip = await getRequestIp();
  await touchSession();

  const formData = await request.formData();
  const rawNames = formData.getAll("filename");
  const filenames: string[] = [];
  for (const raw of rawNames) {
    if (typeof raw === "string" && raw.length > 0) filenames.push(raw);
  }
  if (filenames.length === 0) {
    return NextResponse.json(
      { error: "Žádné filename v requestu." },
      { status: 400 },
    );
  }
  if (filenames.length > MAX_QR_ZIP) {
    return NextResponse.json(
      {
        error: `Najednou max ${MAX_QR_ZIP} QR kódů. Vybráno ${filenames.length}.`,
      },
      { status: 413 },
    );
  }

  // Resolve find IDs in input order. Duplicate IDs (same find selected
  // twice somehow) collapse — there's no value in rendering identical
  // QR PNGs side-by-side in the ZIP. Invalid names are skipped with a
  // server-side log entry so a corrupted selection doesn't poison the
  // whole download.
  const seen = new Set<number>();
  const findIds: number[] = [];
  const skipped: { filename: string; reason: string }[] = [];
  for (const name of filenames) {
    const parsed = parseFindFilename(name);
    if (!parsed.ok) {
      skipped.push({ filename: name, reason: parsed.error });
      continue;
    }
    const id = parsed.value.findId;
    if (seen.has(id)) continue;
    seen.add(id);
    findIds.push(id);
  }
  if (findIds.length === 0) {
    return NextResponse.json(
      {
        error: "Žádný z vybraných souborů nemá platný find ID.",
        skipped,
      },
      { status: 400 },
    );
  }

  // sharp stays as a lazy require inside the handler — the lib is
  // heavy (libvips bindings) and Next.js's default external list
  // already covers it, so the typecast keeps types crisp without
  // pulling sharp into every admin page's cold path. archiver lives
  // at the top of the file as a regular ESM import; it's registered
  // in next.config.ts → serverExternalPackages so Next emits a
  // native Node import that resolves the CJS `module.exports = fn`
  // shape correctly. Either of those alone broke the route in
  // production (bundled archiver mangled to "k is not a function";
  // external require()'d archiver triggered Next's "external
  // packages must use import" build error). The two-pronged setup
  // is the combination Next supports.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sharp = require("sharp") as typeof import("sharp");

  // archiver streams into a Web ReadableStream so the response can
  // start flushing the ZIP header before all PNGs are rasterised.
  // For the ~500-cap that means a perceived "download started" within
  // the first PNG's encode time (~50-100 ms), not after the whole
  // batch completes.
  const archive = archiver("zip", {
    // Light compression — PNGs are already deflate-compressed
    // internally, so high zip levels yield single-digit % savings at
    // 5-10× CPU cost. Level 1 is fine for "bundle these files".
    zlib: { level: 1 },
  });
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      archive.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      archive.on("end", () => controller.close());
      archive.on("error", (err) => controller.error(err));
      archive.on("warning", (err) => {
        // ENOENT et al. — log but don't fail the whole stream.
        console.warn("[admin/qr-zip] archiver warning", err);
      });

      // Drive the encode loop on a microtask so the stream's reader
      // (Next.js) gets the response promise back immediately. Inside
      // this async function each find's PNG is appended sequentially
      // — parallelising would only add sharp memory pressure without
      // helping wall-time at this batch size.
      (async () => {
        for (const findId of findIds) {
          try {
            const svg = renderFindQrSvg(findId);
            const png = await sharp(Buffer.from(svg), { density: 144 })
              .png()
              .toBuffer();
            archive.append(png, { name: `ctyrlistek-${findId}.png` });
          } catch (err) {
            // Single-file failure: log it and keep going. The
            // operator gets whatever rasterised correctly.
            console.error("[admin/qr-zip] render failed", {
              findId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        await archive.finalize();
      })().catch((err) => controller.error(err));
    },
    cancel() {
      // Client disconnected mid-download. Abort the archive so the
      // remaining PNG encodes don't keep CPU+memory busy on a stream
      // nobody's reading.
      archive.abort();
    },
  });

  // Audit the request so a leaked PAT or session-cookie misuse leaves
  // a trail. Only the count + first few IDs go in — the full list of
  // hundreds of IDs would just bloat the JSONL log.
  await appendAudit({
    action: "file.download",
    ip,
    credentialLabel,
    details: {
      scope: "qr-zip",
      requestedCount: filenames.length,
      resolvedCount: findIds.length,
      skippedCount: skipped.length,
      firstIds: findIds.slice(0, 5),
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="qr-codes-${findIds.length}.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
}
