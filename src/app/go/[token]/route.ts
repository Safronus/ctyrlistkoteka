import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { qrTargetPath } from "@/lib/admin/qrTargets";
import { casqbDestination, parseCasqbTargetUrl } from "@/lib/admin/casqbTarget";
import { printableSiteUrl } from "@/lib/printableSiteUrl";

/**
 * QR scan resolver. Generated QR codes encode `/go/<token>`; this handler
 * looks the token up, records a scan (timestamp only — no IP/UA/PII), and
 * 302-redirects: a `page` code to the chosen public page with `?ref=qr`
 * appended so the landing is also attributable in GoatCounter; a `casqb`
 * code to its external https URL, tagged with utm_* so the destination's
 * own analytics can tell scans apart. The site-wide Referrer-Policy
 * (strict-origin-when-cross-origin, set in next.config and again by
 * nginx) means the destination sees only our origin as the referrer,
 * never the /go/<token> path — nothing to add here, and a per-response
 * `no-referrer` would lose to nginx's header anyway.
 *
 * Archived ("Zničený" / "Vyřazený") codes still resolve — a stray scan of
 * an old printout shouldn't 404, and seeing scans on a retired code is
 * useful; the stats show them as scans after retirement. Unknown tokens
 * fall back to the homepage.
 */
export const dynamic = "force-dynamic";

/** Collapse rapid repeat hits on the SAME token into one logged scan per
 *  window, so hammering `/go/<token>` can't inflate a code's scan count or
 *  grow `qr_scans` unbounded. In-memory + per PM2 worker (resets on
 *  restart) — fine, this only bounds abuse; exact counts aren't critical
 *  and a human's genuine re-scans are seconds-to-minutes apart, well
 *  outside the window. Keyed by token, so the map is bounded by the number
 *  of real QR codes (only reached for tokens that resolve to a row). The
 *  redirect itself is never throttled. */
const SCAN_LOG_THROTTLE_MS = 10_000;
const lastScanLoggedAt = new Map<string, number>();

/** Belt and braces beside robots.txt: a 302 carries no meta tag, so the
 *  only way to tell a crawler "don't index this" is the header. */
function noindex(res: NextResponse): NextResponse {
  res.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return res;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  // https vynuceně (printableSiteUrl): posílat návštěvníka na http:// by
  // znamenalo jeden skok navíc a okamžik bez TLS, i když nginx hned
  // přesměruje. Na VPS je `NEXT_PUBLIC_SITE_URL` bez TLS, viz lib/seo.ts.
  const siteUrl = printableSiteUrl();

  let target = "home";
  let locale = "cs";
  let external: URL | null = null;
  if (typeof token === "string" && /^[A-Za-z0-9]{1,16}$/.test(token)) {
    const qr = await prisma.qrCode.findUnique({
      where: { token },
      select: {
        id: true,
        kind: true,
        target: true,
        locale: true,
        targetUrl: true,
        label: true,
      },
    });
    if (qr) {
      target = qr.target;
      locale = qr.locale;
      if (qr.kind === "casqb") {
        // Re-validated on every hop, not just on save: the row is the
        // owner's, but a redirect is the one place a bad URL would go
        // straight to a stranger's phone.
        const parsed = parseCasqbTargetUrl(qr.targetUrl);
        if (parsed.ok) external = casqbDestination(parsed.url, qr.label);
      }
      // Best-effort scan log; never block the redirect on a write error.
      // Throttled per token so a rapid burst logs at most one scan per
      // window (abuse guard — see note above).
      const now = Date.now();
      const prev = lastScanLoggedAt.get(token);
      if (prev === undefined || now - prev >= SCAN_LOG_THROTTLE_MS) {
        lastScanLoggedAt.set(token, now);
        try {
          await prisma.qrScan.create({ data: { qrCodeId: qr.id } });
        } catch {
          /* swallow — redirect the visitor regardless */
        }
      }
    }
  }

  if (external) return noindex(NextResponse.redirect(external, 302));
  const dest = new URL(qrTargetPath(target, locale), siteUrl);
  dest.searchParams.set("ref", "qr");
  return noindex(NextResponse.redirect(dest, 302));
}
