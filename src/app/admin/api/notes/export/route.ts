import { NextResponse, type NextRequest } from "next/server";
import {
  getAdminSession,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";
import { collectNotesToTranslate } from "@/lib/noteTranslations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Download the public find notes + map captions as CS source text ready for
 * translation. Feeds the manual CZ→EN pass; the result is uploaded back via
 * ../import. Anonymized/donated content is excluded server-side (see
 * collectNotesToTranslate).
 *
 * `?all=1` returns EVERYTHING, including entries that already have an EN
 * override (with the current `en` shown) — for a full review pass, since
 * some EN variants are just an untranslated copy of the CS. Without it, only
 * entries that still lack EN are returned.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getAdminSession();
  // Masked 404 for the unauthenticated (matches the admin cloak).
  if (!isAuthenticated(session)) {
    return new NextResponse("Not found", { status: 404 });
  }
  await touchSession();

  const all = new URL(request.url).searchParams.get("all") === "1";
  const data = await collectNotesToTranslate({ all });
  const body = `${JSON.stringify(data, null, 2)}\n`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${
        all ? "ctyrlistkoteka-all-notes.json" : "ctyrlistkoteka-to-translate.json"
      }"`,
      "Cache-Control": "no-store",
    },
  });
}
