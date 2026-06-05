import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { qrTargetPath } from "@/lib/admin/qrTargets";

/**
 * QR scan resolver. Generated QR codes encode `/go/<token>`; this handler
 * looks the token up, records a scan (timestamp only — no IP/UA/PII), and
 * 302-redirects to the chosen public page with `?ref=qr` appended so the
 * landing is also attributable in GoatCounter.
 *
 * Archived ("Zničený") codes still resolve — a stray scan of an old
 * printout shouldn't 404, and seeing scans on a retired code is useful.
 * Unknown tokens fall back to the homepage.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const siteUrl = (
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://ctyrlistkoteka.cz"
  ).replace(/\/$/, "");

  let target = "home";
  let locale = "cs";
  if (typeof token === "string" && /^[A-Za-z0-9]{1,16}$/.test(token)) {
    const qr = await prisma.qrCode.findUnique({
      where: { token },
      select: { id: true, target: true, locale: true },
    });
    if (qr) {
      target = qr.target;
      locale = qr.locale;
      // Best-effort scan log; never block the redirect on a write error.
      try {
        await prisma.qrScan.create({ data: { qrCodeId: qr.id } });
      } catch {
        /* swallow — redirect the visitor regardless */
      }
    }
  }

  const dest = new URL(qrTargetPath(target, locale), siteUrl);
  dest.searchParams.set("ref", "qr");
  return NextResponse.redirect(dest, 302);
}
