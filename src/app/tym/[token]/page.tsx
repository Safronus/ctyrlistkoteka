import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { COLLECTION_TIME_ZONE } from "@/lib/collectionTime";
import { readBoundary } from "@/lib/admin/dropBoundary";
import { resolveDropText } from "@/lib/dropText";
import { dropLandingUrl } from "@/lib/admin/drops";
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
      areas: { select: { id: true, name: true } },
      items: {
        orderBy: { findId: "asc" },
        include: { _count: { select: { scans: true } } },
      },
    },
  });
  if (!campaign) notFound();

  const areaName = new Map(campaign.areas.map((a) => [a.id, a.name]));

  const cards: CrewCard[] = campaign.items.map((i) => {
    // Only this area's cards carry a place. Everything else in the wave is
    // listed so the crew can look a number up, but without saying where it
    // is — one link, one area's secrets.
    const mine = i.areaId === area.id;
    const t = resolveDropText(i, campaign, "cs");
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
    };
  });

  return (
    <CrewView
      token={token}
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
      }}
    />
  );
}
