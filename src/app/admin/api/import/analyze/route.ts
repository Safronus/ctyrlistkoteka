import { promises as fs } from "node:fs";
import { NextResponse, type NextRequest } from "next/server";
import {
  getAdminSession,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";
import {
  importZipPath,
  isValidUploadId,
} from "@/lib/admin/importPackage";
import { analyzeImportZip, type ImportPlan } from "@/lib/admin/importZip";
import {
  isMapPackageZip,
  analyzeMapPackageZip,
  type MapPackageImportPlan,
} from "@/lib/admin/mapPackageImport";
import { recordImportEvent } from "@/lib/admin/importHistory";
import { pluralCs } from "@/lib/format";
import {
  isPhotoPackageZip,
  analyzePhotoPackageZip,
  type PhotoPackagePlan,
} from "@/lib/admin/photoPackageImport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AnalyzeResponse {
  ok: boolean;
  /** "v1" = flat finds/crops/maps/meta package; "v2" = location-map
   *  package; "photos" = real photographs of locations. */
  packageType?: "v1" | "v2" | "photos";
  plan?: ImportPlan;
  mapPlan?: MapPackageImportPlan;
  photoPlan?: PhotoPackagePlan;
  error?: string;
}

/** Read-only analysis of an already-uploaded package (from Z1's chunked
 *  upload). Returns the plan (counts, new vs replace, incomplete pairs,
 *  invalid names, LSP preview). Writes nothing to the collection. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    return json({ ok: false, error: "Not found" }, 404);
  }
  await touchSession();

  let body: { uploadId?: string; fileName?: string };
  try {
    body = (await request.json()) as { uploadId?: string; fileName?: string };
  } catch {
    return json({ ok: false, error: "Neplatné tělo požadavku." }, 400);
  }
  const uploadId = body.uploadId ?? "";
  if (!isValidUploadId(uploadId)) {
    return json({ ok: false, error: "Neplatné upload id." }, 400);
  }

  const zipPath = importZipPath(uploadId);
  let bytes = 0;
  try {
    bytes = (await fs.stat(zipPath)).size;
  } catch {
    return json(
      { ok: false, error: "Nahraný balíček nenalezen — nahraj ho znovu." },
      404,
    );
  }
  // The client knows the file's name; the server only ever sees the id.
  const fileName = (body.fileName ?? "").slice(0, 200) || uploadId;

  try {
    // Photo packages are asked about FIRST: their manifest sits at the same
    // path as the map package's, so whoever asks first has to be the one
    // that can tell them apart by `typ`.
    if (await isPhotoPackageZip(zipPath)) {
      const photoPlan = await analyzePhotoPackageZip(zipPath);
      if ("error" in photoPlan) {
        await recordImportEvent({
          uploadId, fileName, bytes,
          packageType: "photos",
          outcome: "failed",
          error: photoPlan.error,
        });
        return json({ ok: false, error: photoPlan.error }, 400);
      }
      await recordImportEvent({
        uploadId, fileName, bytes,
        packageType: "photos",
        outcome: "analyzed",
        summary:
          `${photoPlan.totalPhotos} ${pluralCs(photoPlan.totalPhotos, ["fotka", "fotky", "fotek"])}` +
          ` pro ${photoPlan.locations.length} ${pluralCs(photoPlan.locations.length, ["lokalitu", "lokality", "lokalit"])}`,
      });
      return json({ ok: true, packageType: "photos", photoPlan });
    }
    // A v2 map package (manifest.json at the zip root) takes the map-package
    // analyzer; anything else is a classic v1 flat package.
    if (await isMapPackageZip(zipPath)) {
      const mapPlan = await analyzeMapPackageZip(zipPath);
      if ("error" in mapPlan) {
        await recordImportEvent({
          uploadId, fileName, bytes,
          packageType: "v2",
          outcome: "failed",
          error: mapPlan.error,
        });
        return json({ ok: false, error: mapPlan.error }, 400);
      }
      await recordImportEvent({
        uploadId, fileName, bytes,
        packageType: "v2",
        outcome: "analyzed",
        summary: `${mapPlan.total} ${pluralCs(mapPlan.total, ["mapa", "mapy", "map"])}`,
      });
      return json({ ok: true, packageType: "v2", mapPlan });
    }
    const plan = await analyzeImportZip(zipPath);
    await recordImportEvent({
      uploadId, fileName, bytes,
      packageType: "v1",
      outcome: "analyzed",
      summary:
        `${plan.finds.total} ${pluralCs(plan.finds.total, ["nález", "nálezy", "nálezů"])}` +
        `, ${plan.crops.total} ${pluralCs(plan.crops.total, ["výřez", "výřezy", "výřezů"])}`,
    });
    return json({ ok: true, packageType: "v1", plan });
  } catch (err) {
    await recordImportEvent({
      uploadId, fileName, bytes,
      packageType: "unknown",
      outcome: "failed",
      error: (err as Error).message,
    });
    console.error("[admin/import/analyze] failed", {
      uploadId,
      message: (err as Error).message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return json(
      { ok: false, error: `Analýza balíčku selhala: ${(err as Error).message}` },
      500,
    );
  }
}

function json(body: AnalyzeResponse, status = 200): NextResponse {
  return NextResponse.json<AnalyzeResponse>(body, { status });
}
