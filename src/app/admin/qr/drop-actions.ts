"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, getRequestIp } from "@/lib/admin/session";
import { appendAudit } from "@/lib/admin/audit";
import { prisma } from "@/lib/db";
import { DropStatus } from "@/generated/prisma/client";
import { parseRanges } from "@/lib/parseRanges";
import { parseGps } from "@/lib/parseGps";
import { newDropToken, scatterPoints } from "@/lib/admin/drops";
import { renderFindQrSvg } from "@/lib/admin/qr";
import { dropLandingUrl, mergeDropQrOptions } from "@/lib/admin/drops";
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

/**
 * Server actions for "darování ve světě".
 *
 * Everything here is admin-only. The hiding coordinates in particular
 * must never leave this surface — see src/lib/admin/drops.ts.
 */

type Result<T> = (T & { ok: true }) | { ok: false; error: string };
type VoidResult = { ok: true } | { ok: false; error: string };

async function auth(): Promise<boolean> {
  try {
    await requireAuth();
    return true;
  } catch {
    return false;
  }
}

function str(v: unknown, max: number): string {
  return String(v ?? "")
    .trim()
    .slice(0, max);
}

/** Empty string → null, so a cleared override falls back to the campaign. */
function nullable(v: unknown, max: number): string | null {
  const s = str(v, max);
  return s.length > 0 ? s : null;
}

function revalidate(campaignId?: number) {
  revalidatePath("/admin/qr");
  if (campaignId) revalidatePath(`/admin/qr/darovani/${campaignId}`);
}

// ---------------------------------------------------------------- campaign

export interface CampaignInput {
  name: string;
  note: string;
  headingCs: string;
  headingEn: string;
  bodyCs: string;
  bodyEn: string;
  bonusCs: string;
  bonusEn: string;
  qrTitle: string;
  /** Newline- or comma-separated crew names. */
  placers: string;
}

function parsePlacers(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[\n,;]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.slice(0, 120)),
    ),
  ];
}

export async function createCampaignAction(
  input: CampaignInput,
): Promise<Result<{ id: number }>> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  const name = str(input.name, 120);
  if (!name) return { ok: false, error: "Vyplň název sady" };
  const headingCs = str(input.headingCs, 200);
  const bodyCs = str(input.bodyCs, 20_000);
  if (!headingCs || !bodyCs) {
    return { ok: false, error: "Vyplň český nadpis a text" };
  }
  try {
    const row = await prisma.dropCampaign.create({
      data: {
        name,
        note: nullable(input.note, 5_000),
        headingCs,
        headingEn: nullable(input.headingEn, 200),
        bodyCs,
        bodyEn: nullable(input.bodyEn, 20_000),
        bonusCs: nullable(input.bonusCs, 20_000),
        bonusEn: nullable(input.bonusEn, 20_000),
        qrTitle: nullable(input.qrTitle, 200),
        placers: parsePlacers(String(input.placers ?? "")),
      },
      select: { id: true },
    });
    revalidate(row.id);
    return { ok: true, id: row.id };
  } catch (e) {
    return { ok: false, error: msg(e, "Založení sady selhalo") };
  }
}

export async function updateCampaignAction(
  id: number,
  input: CampaignInput,
): Promise<VoidResult> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  const name = str(input.name, 120);
  const headingCs = str(input.headingCs, 200);
  const bodyCs = str(input.bodyCs, 20_000);
  if (!name) return { ok: false, error: "Vyplň název sady" };
  if (!headingCs || !bodyCs) {
    return { ok: false, error: "Vyplň český nadpis a text" };
  }
  try {
    await prisma.dropCampaign.update({
      where: { id },
      data: {
        name,
        note: nullable(input.note, 5_000),
        headingCs,
        headingEn: nullable(input.headingEn, 200),
        bodyCs,
        bodyEn: nullable(input.bodyEn, 20_000),
        bonusCs: nullable(input.bonusCs, 20_000),
        bonusEn: nullable(input.bonusEn, 20_000),
        qrTitle: nullable(input.qrTitle, 200),
        placers: parsePlacers(String(input.placers ?? "")),
      },
    });
    revalidate(id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e, "Uložení sady selhalo") };
  }
}

/** Saves the campaign's default QR look. */
export async function saveCampaignQrAction(
  id: number,
  options: Record<string, string>,
): Promise<VoidResult> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  try {
    await prisma.dropCampaign.update({
      where: { id },
      data: { qrOptions: options },
    });
    revalidate(id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e, "Uložení vzhledu selhalo") };
  }
}

export async function deleteCampaignAction(id: number): Promise<VoidResult> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  try {
    const n = await prisma.dropItem.count({ where: { campaignId: id } });
    // Cascade would silently take the items (and their scan history) with
    // it; make the operator empty the set first rather than discovering
    // afterwards that a wave's whole record is gone.
    if (n > 0) {
      return {
        ok: false,
        error: `Sada má ${n} kusů — nejdřív je odeber, teprve pak ji smaž.`,
      };
    }
    await prisma.dropCampaign.delete({ where: { id } });
    revalidate();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e, "Smazání sady selhalo") };
  }
}

// -------------------------------------------------------------------- area

export interface AreaInput {
  name: string;
  center: string;
  zoom: number;
  scatterRadiusM: number | null;
}

export async function saveAreaAction(
  campaignId: number,
  areaId: number | null,
  input: AreaInput,
): Promise<VoidResult> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  const name = str(input.name, 120);
  if (!name) return { ok: false, error: "Vyplň název oblasti" };
  const gps = parseGps(String(input.center ?? ""));
  if (!gps) {
    return {
      ok: false,
      error: "Střed oblasti se nepodařilo přečíst — zkus 49.2245, 17.6712",
    };
  }
  const zoom = Math.min(19, Math.max(1, Math.round(Number(input.zoom) || 14)));
  const radius =
    input.scatterRadiusM === null || !Number.isFinite(input.scatterRadiusM)
      ? null
      : Math.min(50_000, Math.max(10, Number(input.scatterRadiusM)));
  try {
    if (areaId === null) {
      await prisma.dropArea.create({
        data: {
          campaignId,
          name,
          centerLat: gps.lat,
          centerLng: gps.lng,
          zoom,
          scatterRadiusM: radius,
        },
      });
    } else {
      await prisma.dropArea.update({
        where: { id: areaId },
        data: {
          name,
          centerLat: gps.lat,
          centerLng: gps.lng,
          zoom,
          scatterRadiusM: radius,
        },
      });
    }
    revalidate(campaignId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e, "Uložení oblasti selhalo") };
  }
}

export async function deleteAreaAction(
  campaignId: number,
  areaId: number,
): Promise<VoidResult> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  try {
    // Items keep their coordinates and just lose the grouping (the FK is
    // SetNull) — deleting an area must never delete cards.
    await prisma.dropArea.delete({ where: { id: areaId } });
    revalidate(campaignId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e, "Smazání oblasti selhalo") };
  }
}

// ------------------------------------------------------------------- items

/** Adds finds to a campaign by number spec ("30001-30111"). */
export async function addItemsAction(
  campaignId: number,
  spec: string,
  areaId: number | null,
): Promise<Result<{ added: number; missing: number[]; taken: number[] }>> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  let ids: number[];
  try {
    ids = parseRanges(
      String(spec ?? "")
        .split(/[\s,;]+/)
        .filter(Boolean),
    );
  } catch {
    return { ok: false, error: "Neplatný zápis — použij čísla, „5-9“ a čárky" };
  }
  if (ids.length === 0) return { ok: false, error: "Zadej čísla nálezů" };
  if (ids.length > 2000) {
    return { ok: false, error: "Najednou nejvýš 2000 čísel" };
  }
  try {
    const [existing, already] = await Promise.all([
      prisma.find.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      }),
      prisma.dropItem.findMany({
        where: { findId: { in: ids } },
        select: { findId: true },
      }),
    ]);
    const have = new Set(existing.map((f) => f.id));
    const taken = new Set(already.map((i) => i.findId));
    const missing = ids.filter((i) => !have.has(i));
    const fresh = ids.filter((i) => have.has(i) && !taken.has(i));

    for (const findId of fresh) {
      await prisma.dropItem.create({
        data: { campaignId, areaId, findId, token: newDropToken() },
      });
    }
    revalidate(campaignId);
    return {
      ok: true,
      added: fresh.length,
      missing,
      taken: ids.filter((i) => taken.has(i)),
    };
  } catch (e) {
    return { ok: false, error: msg(e, "Přidání kusů selhalo") };
  }
}

export interface ItemInput {
  areaId: number | null;
  status: string;
  placedBy: string;
  gps: string;
  headingCs: string;
  headingEn: string;
  bodyCs: string;
  bodyEn: string;
  bonusCs: string;
  bonusEn: string;
  qrTitle: string;
  hintCs: string;
  hintEn: string;
  hintPublished: boolean;
}

export async function saveItemAction(
  campaignId: number,
  itemId: number,
  input: ItemInput,
): Promise<VoidResult> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  const rawGps = str(input.gps, 200);
  let lat: number | null = null;
  let lng: number | null = null;
  if (rawGps) {
    const parsed = parseGps(rawGps);
    if (!parsed) {
      return {
        ok: false,
        error: "Souřadnice se nepodařilo přečíst — zkus 49.2245, 17.6712",
      };
    }
    lat = parsed.lat;
    lng = parsed.lng;
  }
  const status = DROP_STATUSES.includes(input.status as DropStatus)
    ? (input.status as DropStatus)
    : DropStatus.PREPARED;
  try {
    await prisma.dropItem.update({
      where: { id: itemId },
      data: {
        areaId: input.areaId,
        status,
        placedBy: nullable(input.placedBy, 120),
        lat,
        lng,
        headingCs: nullable(input.headingCs, 200),
        headingEn: nullable(input.headingEn, 200),
        bodyCs: nullable(input.bodyCs, 20_000),
        bodyEn: nullable(input.bodyEn, 20_000),
        bonusCs: nullable(input.bonusCs, 20_000),
        bonusEn: nullable(input.bonusEn, 20_000),
        qrTitle: nullable(input.qrTitle, 200),
        hintCs: nullable(input.hintCs, 5_000),
        hintEn: nullable(input.hintEn, 5_000),
        hintPublished: input.hintPublished === true,
        // Ticking "schovaný" by hand stamps when, so the map can show how
        // long a card has been waiting. FOUND is stamped by the scan.
        placedAt:
          status === DropStatus.HIDDEN || status === DropStatus.FOUND
            ? new Date()
            : null,
      },
    });
    revalidate(campaignId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e, "Uložení kusu selhalo") };
  }
}

const DROP_STATUSES: DropStatus[] = [
  DropStatus.PREPARED,
  DropStatus.PRINTED,
  DropStatus.HIDDEN,
  DropStatus.FOUND,
];

/** Bulk status / crew / area assignment for a checked selection. */
export async function bulkUpdateItemsAction(
  campaignId: number,
  itemIds: number[],
  patch: { status?: string; placedBy?: string; areaId?: number | null },
): Promise<Result<{ updated: number }>> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  const ids = (Array.isArray(itemIds) ? itemIds : []).filter(
    (n) => Number.isInteger(n) && n > 0,
  );
  if (ids.length === 0) return { ok: false, error: "Nic není vybráno" };
  const data: Record<string, unknown> = {};
  if (patch.status && DROP_STATUSES.includes(patch.status as DropStatus)) {
    data.status = patch.status as DropStatus;
  }
  if (patch.placedBy !== undefined) {
    data.placedBy = nullable(patch.placedBy, 120);
  }
  if (patch.areaId !== undefined) data.areaId = patch.areaId;
  if (Object.keys(data).length === 0) {
    return { ok: false, error: "Není co změnit" };
  }
  try {
    const res = await prisma.dropItem.updateMany({
      where: { id: { in: ids }, campaignId },
      data,
    });
    revalidate(campaignId);
    return { ok: true, updated: res.count };
  } catch (e) {
    return { ok: false, error: msg(e, "Hromadná úprava selhala") };
  }
}

export async function removeItemsAction(
  campaignId: number,
  itemIds: number[],
): Promise<Result<{ removed: number }>> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  const ids = (Array.isArray(itemIds) ? itemIds : []).filter(
    (n) => Number.isInteger(n) && n > 0,
  );
  if (ids.length === 0) return { ok: false, error: "Nic není vybráno" };
  try {
    const res = await prisma.dropItem.deleteMany({
      where: { id: { in: ids }, campaignId },
    });
    await appendAudit({
      action: "qr.revoke",
      ip: await getRequestIp(),
      details: { drops: "removed", campaignId, count: res.count },
    });
    revalidate(campaignId);
    return { ok: true, removed: res.count };
  } catch (e) {
    return { ok: false, error: msg(e, "Odebrání selhalo") };
  }
}

/** Random positions for every unplaced card of an area. */
export async function scatterAreaAction(
  campaignId: number,
  areaId: number,
): Promise<Result<{ placed: number }>> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  try {
    const area = await prisma.dropArea.findUnique({ where: { id: areaId } });
    if (!area) return { ok: false, error: "Oblast nenalezena" };
    if (!area.scatterRadiusM) {
      return {
        ok: false,
        error: "Oblast nemá nastavený poloměr pro rozhoz",
      };
    }
    const targets = await prisma.dropItem.findMany({
      where: { areaId, lat: null },
      select: { id: true },
    });
    if (targets.length === 0) {
      return { ok: false, error: "Všechny kusy oblasti už pozici mají" };
    }
    const pts = scatterPoints(
      area.centerLat,
      area.centerLng,
      area.scatterRadiusM,
      targets.length,
    );
    await prisma.$transaction(
      targets.map((t, i) =>
        prisma.dropItem.update({
          where: { id: t.id },
          data: { lat: pts[i]!.lat, lng: pts[i]!.lng },
        }),
      ),
    );
    revalidate(campaignId);
    return { ok: true, placed: targets.length };
  } catch (e) {
    return { ok: false, error: msg(e, "Rozhoz selhal") };
  }
}

/** Sets one card's position — used by clicking the map. */
export async function setItemPositionAction(
  campaignId: number,
  itemId: number,
  lat: number,
  lng: number,
): Promise<VoidResult> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, error: "Neplatné souřadnice" };
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { ok: false, error: "Souřadnice mimo rozsah" };
  }
  try {
    await prisma.dropItem.update({
      where: { id: itemId },
      data: { lat, lng },
    });
    revalidate(campaignId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e, "Uložení pozice selhalo") };
  }
}

/** Renders one card's QR exactly as it will print. */
export async function renderDropQrAction(
  itemId: number,
): Promise<Result<{ svg: string; url: string }>> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  try {
    const item = await prisma.dropItem.findUnique({
      where: { id: itemId },
      include: { campaign: true },
    });
    if (!item) return { ok: false, error: "Kus nenalezen" };
    const url = dropLandingUrl(item.token);
    const o = mergeDropQrOptions(item.campaign.qrOptions, item.qrOptions);
    const title = item.qrTitle ?? item.campaign.qrTitle ?? `🍀 #${item.findId}`;
    return {
      ok: true,
      url,
      svg: renderFindQrSvg(item.findId, {
        url,
        header: title,
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
  } catch (e) {
    return { ok: false, error: msg(e, "Vykreslení QR selhalo") };
  }
}

function msg(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}
