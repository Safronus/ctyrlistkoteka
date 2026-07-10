import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { appendAudit } from "@/lib/admin/audit";
import { drainRequestBody, parseMultipartRequest } from "@/lib/admin/multipart";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";
import { prisma } from "@/lib/db";
import { normalizeToWebp } from "@/lib/images";
import { parseRanges } from "@/lib/parseRanges";
import {
  getExistingPhotosForFinds,
  invalidateFindPhotosCache,
} from "@/lib/findPhotos";
import {
  readDonationShares,
  storeSharedPhoto,
  writeDonationShares,
  type DonationShareAssignment,
} from "@/lib/donationShares";
import {
  MAX_BULK_FINDS,
  MAX_BULK_PHOTOS,
  MAX_FILE_BYTES,
  type BulkAssignPhoto,
  type BulkAssignResponse,
  type BulkCollision,
} from "@/app/admin/files/donation-photos/upload-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Bulk shared donation-photo assignment. Accepts multipart/form-data:
 *   - `files`     — the photos (any format/name); upload order = slot a, b, …
 *   - `range`     — find-id ranges, e.g. "16330-16440,16500"
 *   - `anon`      — "1"/"0": link the photos as anonymized (Nginx-404 file)
 *   - `overwrite` — "1"/"0": replace existing SHARED links on colliding slots
 *
 * Two-pass by design: a first submit with `overwrite=0` that hits any shared
 * collision returns `applied:false` + the collisions (a preview, nothing
 * written), so the operator reviews and resubmits with `overwrite=1`. Per-
 * find photo FILES are never shadowed — a slot they occupy is reported in
 * `keptOwnFile` and skipped, regardless of overwrite.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    return await handle(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[admin/donation-bulk-assign] handler escaped", {
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return json({ applied: false, error: `Server crash: ${message}` }, 500);
  }
}

function json(body: BulkAssignResponse, status = 200): NextResponse {
  return NextResponse.json<BulkAssignResponse>(body, { status });
}
function bad(error: string, status = 400): NextResponse {
  return json({ applied: false, error }, status);
}
/** slot index → letter: 0 → "a", 1 → "b", … (bounded by MAX_BULK_PHOTOS). */
function slotLetter(i: number): string {
  return String.fromCharCode(97 + i);
}

async function handle(request: NextRequest): Promise<NextResponse> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    // Drain the upload body before answering so a mid-upload POST gets a
    // clean 404 rather than a reset connection (surfaces as "Load failed").
    await drainRequestBody(request);
    return new NextResponse("Not found", { status: 404 });
  }
  const credentialLabel = session.credentialLabel!;
  const ip = await getRequestIp();
  await touchSession();

  let parsed;
  try {
    parsed = await parseMultipartRequest(request, {
      maxFileSize: MAX_FILE_BYTES + 1,
      maxFiles: MAX_BULK_PHOTOS,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return bad(`Zpracování nahrávky selhalo: ${message}`);
  }

  const files = parsed.files.filter((f) => f.fieldName === "files");
  const anon = parsed.fields.anon === "1";
  const overwrite = parsed.fields.overwrite === "1";

  // ── validate photos ──────────────────────────────────────────────────
  if (files.length === 0) return bad("Nahraj aspoň jednu fotku.");
  if (files.length > MAX_BULK_PHOTOS)
    return bad(`Max ${MAX_BULK_PHOTOS} fotek na dávku.`);
  for (const f of files) {
    if (f.data.byteLength === 0)
      return bad(`Prázdný soubor: ${f.filename || "(bez názvu)"}.`);
    if (f.data.byteLength > MAX_FILE_BYTES)
      return bad(
        `Soubor ${f.filename || "(bez názvu)"} je větší než ` +
          `${Math.floor(MAX_FILE_BYTES / (1024 * 1024))} MB.`,
      );
  }
  const slots = files.map((_, i) => slotLetter(i));

  // ── validate range ───────────────────────────────────────────────────
  const specs = (parsed.fields.range ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  let rangeIds: number[];
  try {
    rangeIds = parseRanges(specs);
  } catch (err) {
    return bad(`Rozsah čísel: ${(err as Error).message}`);
  }
  const findIds = [...new Set(rangeIds)].filter(
    (n) => Number.isInteger(n) && n > 0,
  );
  if (findIds.length === 0)
    return bad("Zadej platný rozsah čísel nálezů (např. 16330-16440).");
  if (findIds.length > MAX_BULK_FINDS)
    return bad(`Rozsah je moc velký (max ${MAX_BULK_FINDS} nálezů).`);

  // ── validate ids exist in the DB ─────────────────────────────────────
  const rows = await prisma.find.findMany({
    where: { id: { in: findIds } },
    select: { id: true },
  });
  const existing = new Set(rows.map((r) => r.id));
  const targetFindIds = findIds.filter((id) => existing.has(id));
  const unknownFindIds = findIds.filter((id) => !existing.has(id));
  if (targetFindIds.length === 0)
    return json({
      applied: false,
      error: "Žádné z čísel v rozsahu neexistuje ve sbírce.",
      unknownFindIds,
    });

  // ── collision detection (cheap — before any image processing) ────────
  const existingPhotos = await getExistingPhotosForFinds(targetFindIds);
  const slotSet = new Set(slots);
  const collisions: BulkCollision[] = [];
  const keptOwnFile: BulkCollision[] = [];
  for (const findId of targetFindIds) {
    for (const e of existingPhotos.get(findId) ?? []) {
      if (!slotSet.has(e.slot)) continue;
      if (e.filename.startsWith("s_"))
        collisions.push({ findId, slot: e.slot, kind: "manifest" });
      else keptOwnFile.push({ findId, slot: e.slot, kind: "file" });
    }
  }

  // Shared-link collisions block unless the operator confirmed overwrite;
  // return a no-write preview so they can review first.
  if (collisions.length > 0 && !overwrite) {
    return json({
      applied: false,
      targetFindIds,
      unknownFindIds,
      collisions,
      keptOwnFile,
    });
  }

  // ── commit: normalize all photos (all-or-nothing) ────────────────────
  const photos: Array<
    BulkAssignPhoto & { webBuf: Buffer; thumbBuf: Buffer }
  > = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    try {
      const n = await normalizeToWebp(file.data);
      photos.push({
        slot: slots[i]!,
        sha1: n.sha1,
        sourceFormat: n.sourceFormat,
        reused: false,
        webBuf: n.webBuf,
        thumbBuf: n.thumbBuf,
      });
    } catch (err) {
      return bad(
        `Fotku "${file.filename || slots[i]}" se nepodařilo zpracovat jako ` +
          `obrázek: ${(err as Error).message}`,
      );
    }
  }

  // Store the shared files (dedup — an identical photo writes nothing).
  for (const p of photos) {
    const { webWritten } = await storeSharedPhoto({
      sha1: p.sha1,
      anon,
      webBuf: p.webBuf,
      thumbBuf: p.thumbBuf,
    });
    p.reused = !webWritten;
  }

  // Merge links into the manifest: for each target find, replace the shared
  // assignments on the slots we're setting, keep others; never write a slot
  // a per-find FILE already occupies.
  const manifest = await readDonationShares();
  const fileBlocked = new Set(keptOwnFile.map((c) => `${c.findId}:${c.slot}`));
  let assignedLinks = 0;
  for (const findId of targetFindIds) {
    const key = String(findId);
    const setting = new Set(
      slots.filter((s) => !fileBlocked.has(`${findId}:${s}`)),
    );
    const kept = (manifest.assignments[key] ?? []).filter(
      (a) => !setting.has(a.slot),
    );
    const added: DonationShareAssignment[] = photos
      .filter((p) => setting.has(p.slot))
      .map((p) => ({ slot: p.slot, sha1: p.sha1, anon }));
    assignedLinks += added.length;
    const merged = [...kept, ...added];
    if (merged.length > 0) manifest.assignments[key] = merged;
    else delete manifest.assignments[key];
  }
  await writeDonationShares(manifest);

  invalidateFindPhotosCache();
  revalidatePath("/admin/files/donation-photos");
  revalidatePath("/sbirka", "layout");

  await appendAudit({
    action: "file.upload",
    ip,
    credentialLabel,
    details: {
      scope: "donation-photos-bulk",
      photos: photos.map((p) => ({ slot: p.slot, sha1: p.sha1, reused: p.reused })),
      targetCount: targetFindIds.length,
      assignedLinks,
      anon,
      overwrite,
      unknownCount: unknownFindIds.length,
      keptOwnFileCount: keptOwnFile.length,
    },
  });

  return json({
    applied: true,
    photos: photos.map((p) => ({
      slot: p.slot,
      sha1: p.sha1,
      sourceFormat: p.sourceFormat,
      reused: p.reused,
    })),
    targetFindIds,
    unknownFindIds,
    collisions,
    keptOwnFile,
    assignedLinks,
  });
}
