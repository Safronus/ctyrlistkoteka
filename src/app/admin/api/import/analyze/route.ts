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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AnalyzeResponse {
  ok: boolean;
  plan?: ImportPlan;
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
    const plan = await analyzeImportZip(zipPath);
    return json({ ok: true, plan });
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
