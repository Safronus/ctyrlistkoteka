import JSZip from "jszip";
import { NextResponse, type NextRequest } from "next/server";
import { appendAudit } from "@/lib/admin/audit";
import { bodyExceedsLimit } from "@/lib/admin/multipart";
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

/** Hard cap on the number of QR PNGs produced per request. 500 PNGs
 *  at ~50 kB each → ~25 MB peak in-memory, fine on the 12 GB box.
 *  Splitting a 1000-find selection into two 500-find downloads is a
 *  fine UX. */
const MAX_QR_ZIP = 500;

/** POST /admin/api/qr-zip
 *
 *  Body: `multipart/form-data` with one or more `filename` fields
 *  (mirrors the bulk-delete shape so the client can reuse the same
 *  selection set). Each filename is parsed for its find ID via
 *  parseFindFilename — invalid names are skipped silently rather
 *  than aborting the whole batch (the operator still gets whatever's
 *  valid).
 *
 *  Response: `application/zip` named `qr-codes-<count>.zip`
 *  containing one PNG per resolved find ID: `ctyrlistek-<findId>.png`.
 *
 *  Sharp rasterises each SVG (librsvg-backed) at 144 DPI so the PNG
 *  print quality matches the per-find modal's PNG export. JSZip
 *  collects everything in memory and finalises a single buffer.
 *  We tried streaming via archiver first but Next.js's webpack
 *  bundler reshapes archiver's CJS deps in a way that breaks the
 *  call site (`(0, e.default)` referring to a function-typed
 *  module export); JSZip is pure JS, no native bindings, no CJS-ESM
 *  interop surprises. */
export async function POST(request: NextRequest): Promise<Response> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    return new NextResponse("Not found", { status: 404 });
  }
  const credentialLabel = session.credentialLabel!;
  const ip = await getRequestIp();
  await touchSession();

  // Body is just a list of filenames — cap well below Nginx's 200 MB so a
  // runaway request can't buffer a huge FormData into RAM.
  if (bodyExceedsLimit(request, 10 * 1024 * 1024)) {
    return new NextResponse("Payload too large", { status: 413 });
  }
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

  // Resolve find IDs in input order. Duplicates collapse — no value
  // in rendering identical QR PNGs side-by-side. Invalid names are
  // logged + skipped so a single bad filename doesn't poison the
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

  // Sharp is heavy and stays as a lazy CJS require here — same
  // pattern as src/lib/images.ts. Already on Next's default
  // external list (auto-detected as image processor), so we don't
  // need a config flag for it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sharp = require("sharp") as typeof import("sharp").default;

  const zip = new JSZip();
  for (const findId of findIds) {
    try {
      const svg = renderFindQrSvg(findId);
      const png = await sharp(Buffer.from(svg), { density: 144 })
        .png()
        .toBuffer();
      zip.file(`ctyrlistek-${findId}.png`, png);
    } catch (err) {
      // Single-file failure: log it and keep going. The operator
      // gets whatever rasterised correctly.
      console.error("[admin/qr-zip] render failed", {
        findId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    // Light compression — PNGs are already deflate-compressed
    // internally, so high zip levels yield single-digit % savings
    // at 5-10× CPU cost. Level 1 is fine for "bundle these files".
    compression: "DEFLATE",
    compressionOptions: { level: 1 },
  });

  // Audit the request so a leaked PAT or session-cookie misuse
  // leaves a trail. Only the count + first few IDs go in — the
  // full list of hundreds would just bloat the JSONL log.
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

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="qr-codes-${findIds.length}.zip"`,
      "Content-Length": String(buffer.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}
