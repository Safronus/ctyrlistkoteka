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
  readDropQrOptions,
  mergeDropQrOptions,
  resolveQrLines,
  DROP_SIZE_DEFAULT_CM,
} from "@/lib/admin/drops";
import { CampaignSettings } from "./campaign-settings";
import { CampaignStats } from "./campaign-stats";
import { prisma } from "@/lib/db";
import { AreaEditor } from "./area-editor";
import { ItemsGrid, type ItemView } from "./items-grid";
import type { QrDesign } from "./qr-design-fields";
import { AreaMapPanel } from "./area-map-panel";
import { ChainPanel } from "./chain-panel";
import { XlsxPanel } from "./xlsx-panel";
import { SheetPanel } from "./sheet-panel";
import { listDropXlsx } from "@/lib/admin/dropXlsxArchive";
import { listCollageFiles } from "@/lib/admin/collageFiles";
import { readQrPrefs } from "@/lib/admin/qrPrefs";
import { printableSiteUrl } from "@/lib/printableSiteUrl";

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

  const collages = await listCollageFiles();
  // Measured px-per-cm from the QR page's calibration, so both card
  // previews on this page are life-size rather than "some rectangle".
  const { pxPerCm } = await readQrPrefs();
  const campaign = await loadCampaign(campaignId);
  if (!campaign) notFound();

  const lastScan = await prisma.dropScan.findFirst({
    where: { item: { campaignId } },
    orderBy: { scannedAt: "desc" },
    select: { scannedAt: true },
  });
  const lastScanAt = lastScan?.scannedAt ?? null;

  const byStatus = new Map<string, number>();
  let withGps = 0;
  for (const i of campaign.items) {
    byStatus.set(i.status, (byStatus.get(i.status) ?? 0) + 1);
    if (i.lat !== null) withGps += 1;
  }
  const totalScans = campaign.items.reduce((s, i) => s + i._count.scans, 0);

  // The wave's design, with every default already applied, so the forms
  // start from real values rather than from empty strings.
  const campaignOpts = readDropQrOptions(campaign.qrOptions);
  const campaignDesign: QrDesign = {
    titleMode: campaignOpts.titleMode ?? "find",
    title: campaign.qrTitle ?? "",
    captionMode: campaignOpts.captionMode ?? "custom",
    caption: campaign.qrCaption ?? "",
    sizeCm: String(campaignOpts.sizeCm ?? DROP_SIZE_DEFAULT_CM),
    density: campaignOpts.density ?? "medium",
    theme: campaignOpts.theme ?? "brand",
    moduleStyle: campaignOpts.moduleStyle ?? "clover",
    center: campaignOpts.center ?? "smiley",
    centerScale: campaignOpts.centerScale ?? "md",
    border: campaignOpts.border ?? "none",
    borderRadius: campaignOpts.borderRadius ?? "soft",
    borderColor: campaignOpts.borderColor ?? "theme",
  };

  /** Only what a card actually overrides — the rest layers in from above. */
  function ownDesignOf(raw: unknown): Partial<QrDesign> {
    const o = readDropQrOptions(raw);
    const out: Partial<QrDesign> = {};
    if (o.titleMode) out.titleMode = o.titleMode;
    if (o.captionMode) out.captionMode = o.captionMode;
    if (o.sizeCm !== undefined) out.sizeCm = String(o.sizeCm);
    if (o.density) out.density = o.density;
    if (o.theme) out.theme = o.theme;
    if (o.moduleStyle) out.moduleStyle = o.moduleStyle;
    if (o.center) out.center = o.center;
    if (o.centerScale) out.centerScale = o.centerScale;
    if (o.border) out.border = o.border;
    if (o.borderRadius) out.borderRadius = o.borderRadius;
    if (o.borderColor) out.borderColor = o.borderColor;
    return out;
  }

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
    tokenShort: i.token.split("-")[0] ?? i.token.slice(0, 8),
    hintPublished: i.hintPublished,
    // What the finder would actually read: the card's own hint, or the
    // wave's. The grid should show the published TEXT, not the word
    // "nápověda" — a card whose publish flag is on but whose hint is
    // empty publishes nothing, and that is worth seeing.
    hintPreview: (i.hintCs ?? campaign.hintCs ?? "").trim().slice(0, 60),
    teamNote: (i.teamNote ?? "").trim(),
    // Which fields carry an override — the grid shows a dot so it's
    // obvious at a glance which cards deviate from the campaign.
    overrides: [
      i.headingCs || i.headingEn ? "nadpis" : null,
      i.bodyCs || i.bodyEn ? "text" : null,
      i.bonusCs || i.bonusEn ? "bonus" : null,
      i.qrTitle ? "titulek QR" : null,
      i.qrCaption ? "text pod QR" : null,
      i.teamNote ? "poznámka" : null,
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
      qrCaption: i.qrCaption ?? "",
      hintCs: i.hintCs ?? "",
      hintEn: i.hintEn ?? "",
    },
    hasOwnDesign: i.qrOptions !== null,
    ownDesign: ownDesignOf(i.qrOptions),
    // Everything that changes how this card is DRAWN, in one string. The
    // grid caches rendered codes under it, so editing the wave's look (or
    // this card's) invalidates exactly the previews it should — caching
    // by item id meant a saved design never reached the grid until a hard
    // reload.
    renderKey: JSON.stringify([
      i.findId,
      mergeDropQrOptions(campaign.qrOptions, i.qrOptions),
      resolveQrLines(
        mergeDropQrOptions(campaign.qrOptions, i.qrOptions),
        i.findId,
        i.qrTitle,
        campaign.qrTitle,
        i.qrCaption,
        campaign.qrCaption,
      ),
    ]),
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

      <CampaignStats
        campaignId={campaign.id}
        scansPaused={campaign.scansPaused}
        items={campaign.items.map((i) => ({
          status: i.status,
          areaId: i.areaId,
          lat: i.lat,
          scans: i._count.scans,
          foundAt: i.foundAt,
        }))}
        areas={campaign.areas.map((a) => ({ id: a.id, name: a.name }))}
        lastScanAt={lastScanAt}
      />

      <CampaignSettings
        campaignId={campaign.id}
        collages={collages}
        pxPerCm={pxPerCm}
        sheetMode={campaign.sheetMode}
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
          qrCaption: campaign.qrCaption ?? "",
          hintCs: campaign.hintCs ?? "",
          hintEn: campaign.hintEn ?? "",
          design: campaignDesign,
          placers: campaign.placers.join("\n"),
          bgMode: campaign.bgMode,
          bgVariant: campaign.bgVariant,
          bgOpacity: String(campaign.bgOpacity),
          bgCardOpacity: String(campaign.bgCardOpacity),
          bgMobileVariant: campaign.bgMobileVariant,
        }}
      />

      <AreaEditor
        campaignId={campaign.id}
        sheetMode={campaign.sheetMode}
        siteOrigin={printableSiteUrl()}
        areas={campaign.areas.map((a) => ({
          id: a.id,
          name: a.name,
          centerLat: a.centerLat,
          centerLng: a.centerLng,
          zoom: a.zoom,
          scatterRadiusM: a.scatterRadiusM,
          boundary: a.boundary,
          boundaryLabel: a.boundaryLabel,
          crewToken: a.crewToken,
          crewPassword: a.crewPassword,
          itemCount: campaign.items.filter((i) => i.areaId === a.id).length,
          unplaced: campaign.items.filter(
            (i) => i.areaId === a.id && i.lat === null,
          ).length,
        }))}
      />

      <AreaMapPanel
        campaignId={campaign.id}
        sheetMode={campaign.sheetMode}
        areas={campaign.areas.map((a) => ({
          id: a.id,
          name: a.name,
          centerLat: a.centerLat,
          centerLng: a.centerLng,
          zoom: a.zoom,
          scatterRadiusM: a.scatterRadiusM,
          boundary: a.boundary,
        }))}
        items={campaign.items.map((i) => ({
          id: i.id,
          findId: i.findId,
          areaId: i.areaId,
          status: i.status,
          placedBy: i.placedBy,
          lat: i.lat,
          lng: i.lng,
          scans: i._count.scans,
          foundAt: i.foundAt ? dateTimeFmt.format(i.foundAt) : null,
          teamNote: (i.teamNote ?? "").trim(),
        }))}
      />

      <ChainPanel
        campaignId={campaign.id}
        areas={campaign.areas.map((a) => ({
          id: a.id,
          name: a.name,
          chainEnabled: a.chainEnabled,
          items: campaign.items
            .filter((i) => i.areaId === a.id)
            .map((i) => ({
              id: i.id,
              findId: i.findId,
              chainOrder: i.chainOrder,
              // What the finder would actually be shown: the card's own
              // hint, or the wave's. A chained card with neither is a dead
              // end, and the panel says so.
              hasHint: Boolean(
                (i.hintCs ?? i.hintEn ?? campaign.hintCs ?? campaign.hintEn ?? "").trim(),
              ),
            })),
        }))}
      />

      <XlsxPanel
        campaignId={campaign.id}
        campaignName={campaign.name}
        archive={await listDropXlsx(campaign.id)}
      />

      <SheetPanel
        campaignId={campaign.id}
        status={{
          url: campaign.sheetUrl,
          mode: campaign.sheetMode,
          shareCrew: campaign.sheetShareCrew,
          syncedAt: campaign.sheetSyncedAt?.toISOString() ?? null,
          changedAt: campaign.sheetChangedAt?.toISOString() ?? null,
          error: campaign.sheetError,
        }}
      />

      <ItemsGrid
        pxPerCm={pxPerCm}
        campaignId={campaign.id}
        campaignName={campaign.name}
        sheetMode={campaign.sheetMode}
        campaignDefaults={{
          headingCs: campaign.headingCs,
          headingEn: campaign.headingEn ?? "",
          bodyCs: campaign.bodyCs,
          bodyEn: campaign.bodyEn ?? "",
          bonusCs: campaign.bonusCs ?? "",
          bonusEn: campaign.bonusEn ?? "",
          hintCs: campaign.hintCs ?? "",
          hintEn: campaign.hintEn ?? "",
          qrTitle: campaign.qrTitle ?? "",
          qrCaption: campaign.qrCaption ?? "",
          design: campaignDesign,
        }}
        items={items}
        areas={campaign.areas.map((a) => ({ id: a.id, name: a.name }))}
        placers={campaign.placers}
      />
    </div>
  );
}
