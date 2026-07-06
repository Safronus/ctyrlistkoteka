import { NextResponse } from "next/server";
import {
  getAdminSession,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";
import { collectNotesToTranslate } from "@/lib/noteTranslations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Download every public find note + map caption that still lacks an English
 * override, as CS source text ready for translation. Feeds the manual
 * CZ→EN pass; the result is uploaded back via ../import. Anonymized/donated
 * content is excluded server-side (see collectNotesToTranslate).
 */
export async function GET(): Promise<NextResponse> {
  const session = await getAdminSession();
  // Masked 404 for the unauthenticated (matches the admin cloak).
  if (!isAuthenticated(session)) {
    return new NextResponse("Not found", { status: 404 });
  }
  await touchSession();

  const data = await collectNotesToTranslate();
  const body = `${JSON.stringify(data, null, 2)}\n`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition":
        'attachment; filename="ctyrlistkoteka-to-translate.json"',
      "Cache-Control": "no-store",
    },
  });
}
