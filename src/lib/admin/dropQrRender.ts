import type { Prisma } from "@/generated/prisma/client";
import {
  dropLandingUrl,
  mergeDropQrOptions,
  resolveQrLines,
  DROP_SIZE_DEFAULT_CM,
} from "@/lib/admin/drops";
import { renderFindQrSvg } from "@/lib/admin/qr";
import type {
  QrTheme,
  QrModuleStyle,
  QrCenter,
  QrCenterScale,
  QrBorder,
  QrBorderRadius,
  QrBorderColor,
  QrDensity,
} from "@/lib/admin/qr";

export type DropItemWithCampaign = Prisma.DropItemGetPayload<{
  include: { campaign: true };
}>;

/**
 * One card's code, exactly as it will print.
 *
 * Title, caption and every look setting resolve item-over-campaign here
 * and nowhere else, so the grid preview, the single preview, the print
 * sheet and the crew's read-only page cannot drift apart — the whole point
 * of previewing in centimetres is that what you see is what comes out of
 * the printer.
 *
 * Lives outside the actions module because a `"use server"` file may only
 * export async functions, and this is also needed by a route handler.
 */
export function renderDropItemQr(item: DropItemWithCampaign): {
  id: number;
  findId: number;
  svg: string;
  url: string;
  sizeCm: number;
} {
  const url = dropLandingUrl(item.token);
  const o = mergeDropQrOptions(item.campaign.qrOptions, item.qrOptions);
  const lines = resolveQrLines(
    o,
    item.findId,
    item.qrTitle,
    item.campaign.qrTitle,
    item.qrCaption,
    item.campaign.qrCaption,
  );
  return {
    id: item.id,
    findId: item.findId,
    url,
    sizeCm: o.sizeCm ?? DROP_SIZE_DEFAULT_CM,
    svg: renderFindQrSvg(item.findId, {
      url,
      header: lines.title,
      footer: lines.caption,
      density: (o.density ?? "medium") as QrDensity,
      theme: o.theme as QrTheme | undefined,
      moduleStyle: o.moduleStyle as QrModuleStyle | undefined,
      center: o.center as QrCenter | undefined,
      centerScale: o.centerScale as QrCenterScale | undefined,
      border: o.border as QrBorder | undefined,
      borderRadius: o.borderRadius as QrBorderRadius | undefined,
      borderColor: o.borderColor as QrBorderColor | undefined,
    }),
  };
}
