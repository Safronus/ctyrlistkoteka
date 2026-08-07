import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  getAdminSession,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";
import { dropLandingUrl } from "@/lib/admin/drops";
import { buildDropXlsx, type DropXlsxRow } from "@/lib/admin/dropXlsx";
import { COLLECTION_TIME_ZONE } from "@/lib/collectionTime";

/**
 * GET /admin/api/drops/<campaign id>/xlsx
 *
 * The whole wave as one spreadsheet: positions, texts, crew, status. Meant
 * to be edited in Excel and uploaded back — see lib/admin/dropXlsx.ts for
 * the round-trip rules.
 *
 * Auth-gated like every admin route, and it must stay that way: the sheet
 * carries the hiding coordinates, which are the one thing about this whole
 * feature that must never become public.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const dateTimeFmt = new Intl.DateTimeFormat("cs-CZ", {
  day: "numeric",
  month: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: COLLECTION_TIME_ZONE,
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    return new NextResponse("Not found", { status: 404 });
  }
  await touchSession();

  const { id } = await params;
  const campaignId = Number(id);
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    return new NextResponse("Bad request", { status: 400 });
  }

  const campaign = await prisma.dropCampaign.findUnique({
    where: { id: campaignId },
    include: {
      areas: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
      items: {
        orderBy: { findId: "asc" },
        include: {
          area: { select: { name: true } },
          _count: { select: { scans: true } },
        },
      },
    },
  });
  if (!campaign) return new NextResponse("Not found", { status: 404 });

  const rows: DropXlsxRow[] = campaign.items.map((i) => ({
    findId: i.findId,
    area: i.area?.name ?? "",
    status: i.status,
    placedBy: i.placedBy ?? "",
    lat: i.lat,
    lng: i.lng,
    headingCs: i.headingCs ?? "",
    headingEn: i.headingEn ?? "",
    bodyCs: i.bodyCs ?? "",
    bodyEn: i.bodyEn ?? "",
    bonusCs: i.bonusCs ?? "",
    bonusEn: i.bonusEn ?? "",
    qrTitle: i.qrTitle ?? "",
    hintCs: i.hintCs ?? "",
    hintEn: i.hintEn ?? "",
    hintPublished: i.hintPublished,
    landingUrl: dropLandingUrl(i.token),
    scans: i._count.scans,
    foundAt: i.foundAt ? dateTimeFmt.format(i.foundAt) : "",
  }));

  const buf = await buildDropXlsx(
    campaign.name,
    campaign.areas.map((a) => a.name),
    campaign.placers,
    rows,
  );

  const safeName = campaign.name.replace(/[^\p{L}\p{N} _-]/gu, "").trim();
  const filename = `${safeName || "sada"}.xlsx`;

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      // RFC 5987 form alongside a plain ASCII fallback — the campaign name
      // is Czech and a bare filename= would mangle the diacritics.
      "Content-Disposition": `attachment; filename="sada.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}
