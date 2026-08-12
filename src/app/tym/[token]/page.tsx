import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { COLLECTION_TIME_ZONE } from "@/lib/collectionTime";
import { readBoundary } from "@/lib/admin/dropBoundary";
import { resolveDropText } from "@/lib/dropText";
import { resolveChainHint } from "@/lib/dropChain";
import {
  dropLandingUrl,
  mergeDropQrOptions,
  resolveQrLines,
  DROP_SIZE_DEFAULT_CM,
} from "@/lib/admin/drops";
import { CREW_TOKEN_RE, crewCookieName, crewCookieOk } from "@/lib/crewMap";
import { CrewUnlockForm } from "./unlock-form";
import { CrewView, type CrewCard } from "./crew-view";

/**
 * Read-only crew page of one area (`/tym/<token>`).
 *
 * The only route outside /admin that shows where cards are hidden — see
 * src/lib/crewMap.ts for why that is allowed here and nowhere else. Two
 * gates, both required: an unguessable token in the path and the area's
 * password. Neither the area's name nor its existence is revealed before
 * the password is in.
 *
 * The list covers the WHOLE wave so the crew can look anything up, but
 * only THIS area's cards carry a hiding place: a link handed to whoever
 * is covering Zlín must not also give away Ratiboř. Cards from elsewhere
 * appear without coordinates and never on the map.
 *
 * Not linked from anywhere, `noindex`, disallowed in robots.txt and kept
 * out of the sitemap (src/app/sitemap.test.ts).
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mapa pro tým",
  robots: { index: false, follow: false, nocache: true },
};

const dateTimeFmt = new Intl.DateTimeFormat("cs-CZ", {
  day: "numeric",
  month: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: COLLECTION_TIME_ZONE,
});

export default async function CrewMapPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  // Bounded shape before touching the DB — the path is world-reachable.
  if (!CREW_TOKEN_RE.test(token)) notFound();

  const area = await prisma.dropArea.findUnique({
    where: { crewToken: token },
    select: {
      id: true,
      name: true,
      campaignId: true,
      centerLat: true,
      centerLng: true,
      zoom: true,
      scatterRadiusM: true,
      boundary: true,
      crewPassword: true,
    },
  });
  // A switched-off map is a 404, not a locked page: revoking must make the
  // link indistinguishable from one that never existed.
  if (!area?.crewPassword) notFound();

  const jar = await cookies();
  const unlocked = crewCookieOk(
    jar.get(crewCookieName(token))?.value,
    token,
    area.crewPassword,
  );
  if (!unlocked) return <CrewUnlockForm token={token} />;

  const campaign = await prisma.dropCampaign.findUnique({
    where: { id: area.campaignId },
    include: {
      areas: { select: { id: true, name: true, chainEnabled: true } },
      items: {
        orderBy: { findId: "asc" },
        include: {
          _count: { select: { scans: true } },
          // Just the newest one: "kdy naposledy někdo naskenoval" is the
          // half of the history that says whether anything is happening.
          scans: { orderBy: { scannedAt: "desc" }, take: 1 },
        },
      },
    },
  });
  if (!campaign) notFound();

  const areaName = new Map(campaign.areas.map((a) => [a.id, a.name]));

  // The hunt, per area. Built once here rather than per card: the crew
  // needs to see WHICH cards are strung together and in what order,
  // because that is the thing they cannot deduce from a map.
  const chains = new Map<number, { itemId: number; findId: number }[]>();
  for (const a of campaign.areas) {
    if (!a.chainEnabled) continue;
    const links = campaign.items
      .filter((i) => i.areaId === a.id && i.chainOrder != null)
      .sort((x, y) => x.chainOrder! - y.chainOrder!)
      .map((i) => ({ itemId: i.id, findId: i.findId }));
    if (links.length > 0) chains.set(a.id, links);
  }

  const cards: CrewCard[] = campaign.items.map((i, index) => {
    // Only this area's cards carry a place. Everything else in the wave is
    // listed so the crew can look a number up, but without saying where it
    // is — one link, one area's secrets.
    const mine = i.areaId === area.id;
    const t = resolveDropText(i, campaign, "cs");
    const links = i.areaId === null ? undefined : chains.get(i.areaId);
    const at = links?.findIndex((l) => l.itemId === i.id) ?? -1;
    // Card's own hint, else the wave's — exactly what the previous link
    // reveals and what /sbirka shows when it is published.
    const hint = resolveChainHint(i, campaign, "cs");
    return {
      id: i.id,
      findId: i.findId,
      status: i.status,
      mine,
      lat: mine ? i.lat : null,
      lng: mine ? i.lng : null,
      areaLabel: i.areaId === null ? null : (areaName.get(i.areaId) ?? null),
      placedBy: i.placedBy,
      teamNote: mine ? (i.teamNote ?? "").trim() : "",
      scans: i._count.scans,
      foundAt: i.foundAt ? dateTimeFmt.format(i.foundAt) : null,
      landingUrl: dropLandingUrl(i.token),
      heading: t.heading,
      body: t.body,
      // The English side is built from English fields ONLY. resolveDropText
      // would fall back to Czech per field, which under a heading saying
      // "anglicky" is worse than an honest gap.
      en: englishOf(i, campaign),
      bonus: (i.bonusCs ?? campaign.bonusCs ?? "").trim() || null,
      // Which of these the CARD says itself, rather than inheriting from
      // the wave — the difference matters when something reads oddly.
      ownText: [
        i.headingCs || i.headingEn ? "nadpis" : null,
        i.bodyCs || i.bodyEn ? "text" : null,
        i.bonusCs || i.bonusEn ? "bonus" : null,
        i.hintCs || i.hintEn ? "nápověda" : null,
      ].filter(Boolean) as string[],
      printed: printedOf(i, campaign),
      ordinal: index + 1,
      lastScanAt: i.scans[0]
        ? dateTimeFmt.format(i.scans[0].scannedAt)
        : null,
      hint,
      hintPublished: i.hintPublished,
      chain:
        links && at >= 0
          ? {
              position: at + 1,
              total: links.length,
              nextFindId: links[at + 1]?.findId ?? null,
            }
          : null,
    };
  });

  return (
    <CrewView
      token={token}
      placers={campaign.placers}
      total={campaign.items.length}
      areaName={area.name}
      campaignName={campaign.name}
      center={[area.centerLat, area.centerLng]}
      zoom={area.zoom}
      radiusM={area.scatterRadiusM}
      boundary={readBoundary(area.boundary)}
      cards={cards}
      sheet={{
        mode: campaign.sheetMode,
        syncedAt: campaign.sheetSyncedAt?.toISOString() ?? null,
        changedAt: campaign.sheetChangedAt?.toISOString() ?? null,
        error: campaign.sheetError,
        // Only when the operator ticked it. The sheet URL is admin-only
        // data by default (CLAUDE.md §9): that document carries every
        // area's coordinates and usually the right to edit them, which is
        // more than this page is allowed to give away on its own.
        url: campaign.sheetShareCrew ? campaign.sheetUrl : null,
      }}
    />
  );
}

/** The English side of a card, built only from English fields. */
function englishOf(
  item: { headingEn: string | null; bodyEn: string | null; bonusEn: string | null },
  campaign: { headingEn: string | null; bodyEn: string | null; bonusEn: string | null },
): { heading: string; body: string; bonus: string | null } | null {
  const pick = (a: string | null, b: string | null) =>
    (a ?? b ?? "").trim() || null;
  const heading = pick(item.headingEn, campaign.headingEn);
  const body = pick(item.bodyEn, campaign.bodyEn);
  const bonus = pick(item.bonusEn, campaign.bonusEn);
  if (!heading && !body && !bonus) return null;
  return { heading: heading ?? "", body: body ?? "", bonus };
}

/** What is physically on the card: the two lines around the code and how
 *  wide it prints. Resolved item-over-campaign, the same way the printer
 *  resolves it. */
function printedOf(
  item: { findId: number; qrTitle: string | null; qrCaption: string | null; qrOptions: unknown },
  campaign: { qrTitle: string | null; qrCaption: string | null; qrOptions: unknown },
): { title: string | null; caption: string | null; sizeCm: number } {
  const o = mergeDropQrOptions(campaign.qrOptions, item.qrOptions);
  const lines = resolveQrLines(
    o,
    item.findId,
    item.qrTitle,
    campaign.qrTitle,
    item.qrCaption,
    campaign.qrCaption,
  );
  return {
    title: lines.title,
    caption: lines.caption,
    sizeCm: o.sizeCm ?? DROP_SIZE_DEFAULT_CM,
  };
}
