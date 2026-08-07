import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Globe2 } from "lucide-react";
import { ensureAdminAuth } from "@/lib/admin/guard";
import { COLLECTION_TIME_ZONE } from "@/lib/collectionTime";
import {
  loadCampaign,
  DROP_STATUS_LABEL,
  DROP_STATUS_ORDER,
  dropLandingUrl,
} from "@/lib/admin/drops";
import { CampaignSettings } from "./campaign-settings";
import { AreaEditor } from "./area-editor";
import { ItemsGrid, type ItemView } from "./items-grid";

export const metadata: Metadata = {
  title: "Darování ve světě",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const dateTimeFmt = new Intl.DateTimeFormat("cs-CZ", {
  day: "numeric",
  month: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: COLLECTION_TIME_ZONE,
});

export default async function DropCampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await ensureAdminAuth();
  const { id } = await params;
  const campaignId = Number(id);
  if (!Number.isInteger(campaignId) || campaignId <= 0) notFound();

  const campaign = await loadCampaign(campaignId);
  if (!campaign) notFound();

  const byStatus = new Map<string, number>();
  let withGps = 0;
  for (const i of campaign.items) {
    byStatus.set(i.status, (byStatus.get(i.status) ?? 0) + 1);
    if (i.lat !== null) withGps += 1;
  }
  const totalScans = campaign.items.reduce((s, i) => s + i._count.scans, 0);

  const items: ItemView[] = campaign.items.map((i) => ({
    id: i.id,
    findId: i.findId,
    areaId: i.areaId,
    status: i.status,
    placedBy: i.placedBy,
    lat: i.lat,
    lng: i.lng,
    scans: i._count.scans,
    foundAt: i.foundAt ? dateTimeFmt.format(i.foundAt) : null,
    landingUrl: dropLandingUrl(i.token),
    hintPublished: i.hintPublished,
    // Which fields carry an override — the grid shows a dot so it's
    // obvious at a glance which cards deviate from the campaign.
    overrides: [
      i.headingCs || i.headingEn ? "nadpis" : null,
      i.bodyCs || i.bodyEn ? "text" : null,
      i.bonusCs || i.bonusEn ? "bonus" : null,
      i.qrTitle ? "titulek QR" : null,
      i.qrOptions ? "vzhled QR" : null,
      i.hintCs || i.hintEn ? "nápověda" : null,
    ].filter(Boolean) as string[],
    detail: {
      headingCs: i.headingCs ?? "",
      headingEn: i.headingEn ?? "",
      bodyCs: i.bodyCs ?? "",
      bodyEn: i.bodyEn ?? "",
      bonusCs: i.bonusCs ?? "",
      bonusEn: i.bonusEn ?? "",
      qrTitle: i.qrTitle ?? "",
      hintCs: i.hintCs ?? "",
      hintEn: i.hintEn ?? "",
    },
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link
          href="/admin/qr"
          className="inline-flex items-center gap-1 hover:text-gray-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          QR kódy
        </Link>
        <span aria-hidden>/</span>
        <span className="text-gray-900">Darování ve světě</span>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
            <Globe2 className="h-5 w-5 text-emerald-600" aria-hidden />
            {campaign.name}
          </h1>
          {campaign.note && (
            <p className="mt-0.5 max-w-2xl text-sm text-gray-500">
              {campaign.note}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-4 text-center">
          {DROP_STATUS_ORDER.map((s) => (
            <div key={s}>
              <p className="font-mono text-xl font-bold tabular-nums text-gray-900">
                {byStatus.get(s) ?? 0}
              </p>
              <p className="text-[10px] uppercase tracking-wide text-gray-400">
                {DROP_STATUS_LABEL[s]}
              </p>
            </div>
          ))}
          <div>
            <p className="font-mono text-xl font-bold tabular-nums text-emerald-700">
              {totalScans}
            </p>
            <p className="text-[10px] uppercase tracking-wide text-gray-400">
              naskenování
            </p>
          </div>
          <div>
            <p className="font-mono text-xl font-bold tabular-nums text-gray-900">
              {withGps}/{campaign.items.length}
            </p>
            <p className="text-[10px] uppercase tracking-wide text-gray-400">
              má pozici
            </p>
          </div>
        </div>
      </header>

      <CampaignSettings
        campaignId={campaign.id}
        initial={{
          name: campaign.name,
          note: campaign.note ?? "",
          headingCs: campaign.headingCs,
          headingEn: campaign.headingEn ?? "",
          bodyCs: campaign.bodyCs,
          bodyEn: campaign.bodyEn ?? "",
          bonusCs: campaign.bonusCs ?? "",
          bonusEn: campaign.bonusEn ?? "",
          qrTitle: campaign.qrTitle ?? "",
          placers: campaign.placers.join("\n"),
        }}
      />

      <AreaEditor
        campaignId={campaign.id}
        areas={campaign.areas.map((a) => ({
          id: a.id,
          name: a.name,
          centerLat: a.centerLat,
          centerLng: a.centerLng,
          zoom: a.zoom,
          scatterRadiusM: a.scatterRadiusM,
          itemCount: campaign.items.filter((i) => i.areaId === a.id).length,
          unplaced: campaign.items.filter(
            (i) => i.areaId === a.id && i.lat === null,
          ).length,
        }))}
      />

      <ItemsGrid
        campaignId={campaign.id}
        items={items}
        areas={campaign.areas.map((a) => ({ id: a.id, name: a.name }))}
        placers={campaign.placers}
      />
    </div>
  );
}
