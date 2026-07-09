import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { appendAudit } from "@/lib/admin/audit";
import { bodyExceedsLimit } from "@/lib/admin/multipart";
import {
  getAdminSession,
  getRequestIp,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";
import {
  applyNoteTranslations,
  type TranslationImportInput,
} from "@/lib/noteTranslations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Upload translated notes/captions. Body is the JSON produced from the
 * export, translated:
 *   { "finds": { "16230": "English note" }, "maps": { "55": "English caption" } }
 * Only the `en` variant is written per id (CS keeps tracking its source).
 * Refreshes the public find + location pages so the EN shows immediately.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    return new NextResponse("Not found", { status: 404 });
  }
  const credentialLabel = session.credentialLabel!;
  const ip = await getRequestIp();
  await touchSession();

  // Notes JSON for the whole collection is at most a few MB; cap generously
  // below Nginx's 200 MB so a runaway body can't buffer into RAM.
  if (bodyExceedsLimit(request, 50 * 1024 * 1024)) {
    return new NextResponse("Payload too large", { status: 413 });
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Neplatný JSON: ${(err as Error).message}` },
      { status: 400 },
    );
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    ((payload as TranslationImportInput).finds === undefined &&
      (payload as TranslationImportInput).maps === undefined)
  ) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Očekávám objekt { finds?: { "id": "…" }, maps?: { "id": "…" } }.',
      },
      { status: 400 },
    );
  }

  let result;
  try {
    result = await applyNoteTranslations(payload as TranslationImportInput);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Import selhal: ${(err as Error).message}` },
      { status: 500 },
    );
  }

  await appendAudit({
    action: "json.update",
    ip,
    credentialLabel,
    details: {
      scope: "note-translations-import",
      finds: result.finds,
      maps: result.maps,
    },
  });

  // Refresh public pages that render the notes/captions (all locales) +
  // the admin page's counts.
  revalidatePath("/[locale]/sbirka/[id]", "page");
  revalidatePath("/[locale]/lokality/[mapId]", "page");
  revalidatePath("/admin/translations");

  return NextResponse.json({ ok: true, ...result });
}
