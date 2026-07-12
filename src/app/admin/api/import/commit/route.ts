import { promises as fs } from "node:fs";
import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { appendAudit } from "@/lib/admin/audit";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";
import {
  cleanupImportUpload,
  importZipPath,
  isValidUploadId,
} from "@/lib/admin/importPackage";
import { commitImportFiles, type ImportFileSummary } from "@/lib/admin/importZip";
import {
  mergeWholeFile,
  type WholeFileMergeResult,
} from "@/app/admin/json/lokace-stavy-poznamky/merge-whole-action";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CommitResponse {
  ok: boolean;
  error?: string;
  summary?: ImportFileSummary;
  /** Result of the LSP whole-file merge, or null when the package had none. */
  lsp?: WholeFileMergeResult | null;
}

/**
 * Commits an analyzed package: streams its photos + maps into the data/ dirs
 * (replacing by find-id / MAP_ID, old → .trash) and whole-file-merges the LSP
 * JSON. Writes NO DB — the operator runs /admin/sync afterwards. The temp ZIP
 * is deleted whether this succeeds or fails (idempotent — re-upload to retry).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    return json({ ok: false, error: "Not found" }, 404);
  }
  const credentialLabel = session.credentialLabel!;
  const ip = await getRequestIp();
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
    // 1) stage photos + maps (id/map-id replace).
    const summary = await commitImportFiles(zipPath);

    // 2) whole-file-merge the bundled LSP JSON (reuses the editor's merge —
    //    additive, conflict-aborting, snapshots to .trash + a rotating backup).
    let lsp: WholeFileMergeResult | null = null;
    if (summary.lspContent) {
      const fd = new FormData();
      fd.append("content", summary.lspContent);
      lsp = await mergeWholeFile(fd);
    }

    await appendAudit({
      action: "file.replace",
      ip,
      credentialLabel,
      details: {
        scope: "import-package",
        finds: summary.finds,
        crops: summary.crops,
        maps: summary.maps,
        errorCount: summary.errors.length,
        lspMerged: lsp?.ok ?? false,
      },
    });

    revalidatePath("/admin/files/finds", "layout");
    revalidatePath("/admin/sync");

    return json({ ok: true, summary, lsp });
  } catch (err) {
    console.error("[admin/import/commit] failed", {
      uploadId,
      message: (err as Error).message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return json(
      { ok: false, error: `Import selhal: ${(err as Error).message}` },
      500,
    );
  } finally {
    // Delete the temp ZIP either way — the import is idempotent, so a retry
    // just re-uploads.
    await cleanupImportUpload(uploadId);
  }
}

function json(body: CommitResponse, status = 200): NextResponse {
  return NextResponse.json<CommitResponse>(body, { status });
}
