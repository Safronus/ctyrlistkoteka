import { NextResponse } from "next/server";
import {
  getCloverTexts,
  getCloverTranslations,
} from "@/lib/cloverTextsServer";

/**
 * Full clover-fact set (texts + EN translations), fetched on-demand by the
 * homepage `CloverFactCard` after it hydrates. The page ships only a small
 * random seed in the initial HTML, so the ~210-entry collection no longer
 * bloats every homepage load — it comes down here once, cached, when the
 * rotator actually needs the rest.
 *
 * Public read-only data (the same entries were previously inlined in the
 * page HTML), so no auth. `force-dynamic` keeps it reading fresh from disk
 * — the loader's mtime memo makes that cheap and reflects /admin edits —
 * while the Cache-Control header lets the browser/proxy hold it briefly.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [texts, translations] = await Promise.all([
    getCloverTexts(),
    getCloverTranslations(),
  ]);
  return NextResponse.json(
    { texts, translations },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
