import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { appendAudit } from "@/lib/admin/audit";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";
import { prisma } from "@/lib/db";
import { parseRanges } from "@/lib/parseRanges";
import {
  getExistingPhotosForFinds,
  invalidateFindPhotosCache,
} from "@/lib/findPhotos";
import {
  isPhotoStaged,
  promoteStagedPhoto,
  readDonationShares,
  writeDonationShares,
  type DonationShareAssignment,
} from "@/lib/donationShares";
import {
  MAX_BULK_FINDS,
  MAX_BULK_PHOTOS,
  type BulkAssignPhoto,
  type BulkAssignRequest,
  type BulkAssignResponse,
  type BulkCollision,
} from "@/app/admin/files/donation-photos/upload-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SHA1_RE = /^[0-9a-f]{40}$/;

/**
 * Step 2 of the bulk shared-photo flow (JSON — no file bytes, so it can't
 * truncate). Links already-STAGED photos (uploaded via /donation-shared-
 * upload) to a range of finds. Order of `sha1s` = slot a, b, c…
 *
 * Two-pass: a first call with `overwrite=false` that hits any SHARED-link
 * collision returns `applied:false` + the collisions (nothing written), so
 * the operator reviews and resubmits with `overwrite=true`. Per-find photo
 * FILES are never shadowed — a slot they occupy is reported in `keptOwnFile`
 * and skipped, regardless of overwrite.
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
function slotLetter(i: number): string {
  return String.fromCharCode(97 + i);
}

async function handle(request: NextRequest): Promise<NextResponse> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    return new NextResponse("Not found", { status: 404 });
  }
  const credentialLabel = session.credentialLabel!;
  const ip = await getRequestIp();
  await touchSession();

  let body: BulkAssignRequest;
  try {
    body = (await request.json()) as BulkAssignRequest;
  } catch {
    return bad("Neplatné tělo požadavku.");
  }

  const anon = body.anon === true;
  const overwrite = body.overwrite === true;

  // ── validate staged photos ───────────────────────────────────────────
  const sha1s = Array.isArray(body.sha1s)
    ? body.sha1s.map((s) => String(s).toLowerCase())
    : [];
  if (sha1s.length === 0) return bad("Nejsou nahrané žádné fotky.");
  if (sha1s.length > MAX_BULK_PHOTOS)
    return bad(`Max ${MAX_BULK_PHOTOS} fotek na dávku.`);
  if (!sha1s.every((s) => SHA1_RE.test(s))) return bad("Neplatný identifikátor fotky.");
  for (const sha1 of sha1s) {
    if (!(await isPhotoStaged(sha1)))
      return bad("Některá fotka už není nahraná — nahraj fotky znovu a zkus to.");
  }
  const slots = sha1s.map((_, i) => slotLetter(i));

  // ── validate range ───────────────────────────────────────────────────
  const specs = String(body.range ?? "")
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

  // ── collision detection ──────────────────────────────────────────────
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
  if (collisions.length > 0 && !overwrite) {
    return json({
      applied: false,
      targetFindIds,
      unknownFindIds,
      collisions,
      keptOwnFile,
    });
  }

  // ── commit: promote staged photos to served, then link ───────────────
  const photos: BulkAssignPhoto[] = [];
  for (let i = 0; i < sha1s.length; i++) {
    const sha1 = sha1s[i]!;
    const { webWritten } = await promoteStagedPhoto(sha1, anon);
    photos.push({ slot: slots[i]!, sha1, reused: !webWritten });
  }

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
    photos,
    targetFindIds,
    unknownFindIds,
    collisions,
    keptOwnFile,
    assignedLinks,
  });
}
