import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  getAdminSession,
  isAuthenticated,
  touchSession,
} from "@/lib/admin/session";
import {
  dropLandingUrl,
  readDropQrOptions,
  mergeDropQrOptions,
  resolveQrLines,
  DROP_SIZE_DEFAULT_CM,
} from "@/lib/admin/drops";
import { buildDropXlsx, type DropXlsxRow } from "@/lib/admin/dropXlsx";

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

  // Filled in, not left blank.
  //
  // An empty cell still MEANS "inherit", but a sheet that shows nothing
  // is useless to the crew: to adjust one sentence for one card you had
  // to go and find that sentence first. So every text arrives showing
  // what the card would actually say, and the import treats a value equal
  // to the campaign's as "still inheriting" — exactly the rule the admin
  // dialog uses. Editing a cell is therefore how you override, and
  // leaving it alone changes nothing.
  const campaignDesign = readDropQrOptions(campaign.qrOptions);
  const rows: DropXlsxRow[] = campaign.items.map((i, index) => {
    const lines = resolveQrLines(
      mergeDropQrOptions(campaign.qrOptions, i.qrOptions),
      i.findId,
      i.qrTitle,
      campaign.qrTitle,
      i.qrCaption,
      campaign.qrCaption,
    );
    const own = readDropQrOptions(i.qrOptions);
    return {
      ordinal: index + 1,
      findId: i.findId,
      area: i.area?.name ?? "",
      status: i.status,
      placedBy: i.placedBy ?? "",
      lat: i.lat,
      lng: i.lng,
      headingCs: i.headingCs ?? campaign.headingCs,
      headingEn: i.headingEn ?? campaign.headingEn ?? "",
      bodyCs: i.bodyCs ?? campaign.bodyCs,
      bodyEn: i.bodyEn ?? campaign.bodyEn ?? "",
      bonusCs: i.bonusCs ?? campaign.bonusCs ?? "",
      bonusEn: i.bonusEn ?? campaign.bonusEn ?? "",
      // What is actually printed, "no text" included — the sheet should
      // not imply a title exists when the card has none.
      qrTitle: lines.title ?? "",
      qrCaption: lines.caption ?? "",
      sizeCm: String(own.sizeCm ?? campaignDesign.sizeCm ?? DROP_SIZE_DEFAULT_CM),
      hintCs: i.hintCs ?? campaign.hintCs ?? "",
      hintEn: i.hintEn ?? campaign.hintEn ?? "",
      hintPublished: i.hintPublished,
      landingUrl: dropLandingUrl(i.token),
      note: "",
    };
  });

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
