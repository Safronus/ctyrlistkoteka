import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Find QR scan resolver. Find QR codes encode `/n/<find id>` — a short,
 * DETERMINISTIC address, unlike the page codes' random `/go/<token>`.
 * That matters because these get printed onto cards handed out with
 * donated clovers: reprinting a card years later has to produce the very
 * same code, and a card already in someone's hands must never stop
 * working. A minted token would change on every regeneration.
 *
 * The handler records a scan (timestamp + find id only — no IP/UA/PII)
 * and 302-redirects to the find detail with `?ref=qr` so the landing is
 * also attributable in GoatCounter.
 *
 * Unknown or deleted find ids still redirect (to the collection listing)
 * rather than 404 — a stray scan of an old card shouldn't dead-end.
 */
export const dynamic = "force-dynamic";

/** Collapse rapid repeat hits on the SAME find into one logged scan per
 *  window, so hammering `/n/<id>` can't inflate a find's scan count or
 *  grow `find_qr_scans` unbounded. In-memory + per PM2 worker (resets on
 *  restart) — fine, this only bounds abuse; exact counts aren't critical
 *  and a human's genuine re-scans are seconds-to-minutes apart, well
 *  outside the window. Keyed by find id, and only reached for ids that
 *  resolve to a row, so the map is bounded by the collection size. The
 *  redirect itself is never throttled. */
const SCAN_LOG_THROTTLE_MS = 10_000;
const lastScanLoggedAt = new Map<number, number>();

/** Belt and braces beside robots.txt: a 302 carries no meta tag, so the
 *  only way to tell a crawler "don't index this" is the header. */
function noindex(res: NextResponse): NextResponse {
  res.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return res;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const siteUrl = (
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://ctyrlistkoteka.cz"
  ).replace(/\/$/, "");

  // Bounded pattern before touching the DB — `/n/<anything>` is public,
  // so an unparsable id must cost nothing.
  let findId: number | null = null;
  if (/^\d{1,9}$/.test(id)) {
    const n = Number(id);
    if (n > 0) findId = n;
  }

  let path = "/sbirka";
  let tracked = false;
  if (findId !== null) {
    const find = await prisma.find.findUnique({
      where: { id: findId },
      select: { id: true, qrCode: { select: { revokedAt: true } } },
    });
    if (find) {
      path = `/sbirka/${find.id}`;
      // A revoked code still resolves — a card already handed out must
      // never dead-end — it just stops being counted, and drops `ref=qr`
      // so it doesn't show up as a QR landing in GoatCounter either.
      tracked = find.qrCode?.revokedAt == null;
      if (tracked) {
        // Best-effort scan log; never block the redirect on a write error.
        const now = Date.now();
        const prev = lastScanLoggedAt.get(find.id);
        if (prev === undefined || now - prev >= SCAN_LOG_THROTTLE_MS) {
          lastScanLoggedAt.set(find.id, now);
          try {
            await prisma.findQrScan.create({ data: { findId: find.id } });
          } catch {
            /* swallow — redirect the visitor regardless */
          }
        }
      }
    }
  }

  const dest = new URL(path, siteUrl);
  if (tracked) dest.searchParams.set("ref", "qr");
  return noindex(NextResponse.redirect(dest, 302));
}
