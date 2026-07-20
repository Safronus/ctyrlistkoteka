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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AnalyzeResponse {
  ok: boolean;
  /** "v1" = flat finds/crops/maps/meta package; "v2" = location-map package. */
  packageType?: "v1" | "v2";
  plan?: ImportPlan;
  mapPlan?: MapPackageImportPlan;
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

  let body: { uploadId?: string };
  try {
    body = (await request.json()) as { uploadId?: string };
  } catch {
    return json({ ok: false, error: "Neplatné tělo požadavku." }, 400);
  }
  const uploadId = body.uploadId ?? "";
  if (!isValidUploadId(uploadId)) {
    return json({ ok: false, error: "Neplatné upload id." }, 400);
  }

  const zipPath = importZipPath(uploadId);
  try {
    await fs.access(zipPath);
  } catch {
    return json(
      { ok: false, error: "Nahraný balíček nenalezen — nahraj ho znovu." },
      404,
    );
  }

  try {
    // A v2 map package (manifest.json at the zip root) takes the map-package
    // analyzer; anything else is a classic v1 flat package.
    if (await isMapPackageZip(zipPath)) {
      const mapPlan = await analyzeMapPackageZip(zipPath);
      if ("error" in mapPlan) {
        return json({ ok: false, error: mapPlan.error }, 400);
      }
      return json({ ok: true, packageType: "v2", mapPlan });
    }
    const plan = await analyzeImportZip(zipPath);
    return json({ ok: true, packageType: "v1", plan });
  } catch (err) {
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
