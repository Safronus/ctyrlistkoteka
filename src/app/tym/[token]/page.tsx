import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { COLLECTION_TIME_ZONE } from "@/lib/collectionTime";
import { readBoundary } from "@/lib/admin/dropBoundary";
import { CREW_TOKEN_RE, crewCookieName, crewCookieOk } from "@/lib/crewMap";
import { CrewUnlockForm } from "./unlock-form";
import { CrewView, type CrewCard } from "./crew-view";

/**
 * Read-only crew map of one area (`/tym/<token>`).
 *
 * The only route outside /admin that shows where cards are hidden — see
 * src/lib/crewMap.ts for why that is allowed here and nowhere else. Two
 * gates, both required: an unguessable token in the path and the area's
 * password. Neither the area's name nor its existence is revealed before
 * the password is in.
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
    include: {
      campaign: { select: { name: true } },
      items: {
        orderBy: { findId: "asc" },
        include: { _count: { select: { scans: true } } },
      },
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

  // Cards without coordinates have nothing to draw and nothing the crew
  // could walk to; they stay in the admin.
  const cards: CrewCard[] = area.items
    .filter((i) => i.lat !== null && i.lng !== null)
    .map((i) => ({
      id: i.id,
      findId: i.findId,
      status: i.status,
      lat: i.lat!,
      lng: i.lng!,
      placedBy: i.placedBy,
      teamNote: (i.teamNote ?? "").trim(),
      scans: i._count.scans,
      foundAt: i.foundAt ? dateTimeFmt.format(i.foundAt) : null,
    }));

  return (
    <CrewView
      areaName={area.name}
      campaignName={area.campaign.name}
      center={[area.centerLat, area.centerLng]}
      zoom={area.zoom}
      radiusM={area.scatterRadiusM}
      boundary={readBoundary(area.boundary)}
      cards={cards}
    />
  );
}
