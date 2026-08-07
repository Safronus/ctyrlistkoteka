"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, getRequestIp } from "@/lib/admin/session";
import { appendAudit } from "@/lib/admin/audit";
import { prisma } from "@/lib/db";
import { DropStatus, Prisma } from "@/generated/prisma/client";
import { parseRanges } from "@/lib/parseRanges";
import { parseGps, formatGpsDecimal } from "@/lib/parseGps";
import { newDropToken, scatterPoints } from "@/lib/admin/drops";
import { readBoundary, scatterInBoundary } from "@/lib/admin/dropBoundary";
import {
  findBoundaries,
  type BoundaryCandidate,
} from "@/lib/admin/dropNominatim";
import { parseDropXlsx } from "@/lib/admin/dropXlsx";
import { renderFindQrSvg } from "@/lib/admin/qr";
import {
  dropLandingUrl,
  mergeDropQrOptions,
  readDropQrOptions,
  clampDropSizeCm,
  DROP_SIZE_DEFAULT_CM,
} from "@/lib/admin/drops";
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
  qrCaption: string;
  /** Printed width in cm, as typed. Empty falls back to the default. */
  sizeCm: string;
  /** Newline- or comma-separated crew names. */
  placers: string;
}

/**
 * Writes the print size into the campaign's option bag without touching
 * the look settings that share it — density, theme, border and friends
 * are set elsewhere and a blind overwrite would silently reset them.
 */
function withSizeCm(existing: unknown, raw: string): Prisma.InputJsonObject {
  const bag: Record<string, unknown> = {
    ...(existing && typeof existing === "object"
      ? (existing as Record<string, unknown>)
      : {}),
  };
  const size = clampDropSizeCm(raw.replace(",", "."));
  if (size === undefined) delete bag.sizeCm;
  else bag.sizeCm = size;
  return bag as Prisma.InputJsonObject;
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
        qrCaption: nullable(input.qrCaption, 200),
        qrOptions: withSizeCm(null, str(input.sizeCm, 10)),
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
    const current = await prisma.dropCampaign.findUnique({
      where: { id },
      select: { qrOptions: true },
    });
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
        qrCaption: nullable(input.qrCaption, 200),
        qrOptions: withSizeCm(current?.qrOptions, str(input.sizeCm, 10)),
        placers: parsePlacers(String(input.placers ?? "")),
      },
    });
    revalidate(id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e, "Uložení sady selhalo") };
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

/**
 * Asks OSM what it knows by that name, best match first.
 *
 * Deliberately does NOT save: searching "Zlín" turns up the town AND the
 * region named after it, and picking for the operator is how a wave ends
 * up scattered across half a county. The geometries come back with the
 * list so choosing one costs nothing further.
 *
 * This is the app's only third-party call. It goes out from the admin
 * only, carries nothing but a place name, and once a shape is stored
 * nothing asks again.
 */
export async function searchAreaBoundariesAction(
  query: string,
): Promise<Result<{ candidates: BoundaryCandidate[] }>> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  const q = str(query, 200);
  if (!q) return { ok: false, error: "Zadej název místa" };
  try {
    const candidates = await findBoundaries(q);
    if (candidates.length === 0) {
      return {
        ok: false,
        error: `Pro „${q}“ OSM žádnou hranici nemá. Zkus přesnější název, třeba „Zlín, Česko“.`,
      };
    }
    return { ok: true, candidates };
  } catch (e) {
    return { ok: false, error: msg(e, "Dotaz do OSM selhal") };
  }
}

/** Stores a chosen outline on the area. Re-validated here — the shape
 *  arrives from the browser and everything from a client is input. */
export async function applyAreaBoundaryAction(
  campaignId: number,
  areaId: number,
  label: string,
  geometry: unknown,
): Promise<VoidResult> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  const boundary = readBoundary(geometry);
  if (!boundary) return { ok: false, error: "Neplatný tvar hranice" };
  try {
    await prisma.dropArea.update({
      where: { id: areaId },
      data: {
        boundary: boundary as unknown as Prisma.InputJsonObject,
        boundaryLabel: str(label, 300) || null,
      },
    });
    await appendAudit({
      action: "settings.update",
      ip: await getRequestIp(),
      details: { drops: "area-boundary", campaignId, areaId },
    });
    revalidate(campaignId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e, "Uložení hranice selhalo") };
  }
}

/** Drops a stored outline, so the scatter falls back to the radius. */
export async function clearAreaBoundaryAction(
  campaignId: number,
  areaId: number,
): Promise<VoidResult> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  try {
    await prisma.dropArea.update({
      where: { id: areaId },
      data: { boundary: Prisma.DbNull, boundaryLabel: null },
    });
    revalidate(campaignId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e, "Smazání hranice selhalo") };
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
  qrCaption: string;
  /** Printed width in cm. Empty = inherit the campaign's size. */
  sizeCm: string;
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
    const current = await prisma.dropItem.findUnique({
      where: { id: itemId },
      select: { qrOptions: true },
    });
    // An item's option bag is an override layer: with no size of its own
    // it must stay ABSENT rather than become the campaign's value copied
    // in, otherwise changing the wave's size would stop propagating.
    const bag = withSizeCm(current?.qrOptions, str(input.sizeCm, 10));
    await prisma.dropItem.update({
      where: { id: itemId },
      data: {
        qrOptions: Object.keys(bag).length > 0 ? bag : Prisma.DbNull,
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
        qrCaption: nullable(input.qrCaption, 200),
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
  patch: {
    status?: string;
    placedBy?: string;
    areaId?: number | null;
    hintPublished?: boolean;
  },
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
  // Publishing a hint only reveals text that is already written; a card
  // with an empty hint stays silent either way (see getPublishedDropHint).
  if (patch.hintPublished !== undefined) {
    data.hintPublished = patch.hintPublished === true;
  }
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

/**
 * Random positions for every unplaced card of an area.
 *
 * Prefers the town's real outline when it has one — a 2.5 km circle round
 * Zlín is half hillside and field, and a card "hidden" up there is a card
 * nobody finds. The radius stays as the fallback, and also covers the
 * leftovers if a pathological shape defeats rejection sampling.
 */
export async function scatterAreaAction(
  campaignId: number,
  areaId: number,
): Promise<Result<{ placed: number; inBoundary: number }>> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  try {
    const area = await prisma.dropArea.findUnique({ where: { id: areaId } });
    if (!area) return { ok: false, error: "Oblast nenalezena" };
    const boundary = readBoundary(area.boundary);
    if (!area.scatterRadiusM && !boundary) {
      return {
        ok: false,
        error: "Oblast nemá ani hranici, ani poloměr pro rozhoz",
      };
    }
    const targets = await prisma.dropItem.findMany({
      where: { areaId, lat: null },
      select: { id: true },
    });
    if (targets.length === 0) {
      return { ok: false, error: "Všechny kusy oblasti už pozici mají" };
    }

    const pts: Array<{ lat: number; lng: number }> = [];
    let inBoundary = 0;
    if (boundary) {
      const got = scatterInBoundary(boundary, targets.length);
      pts.push(...got.points);
      inBoundary = got.points.length;
    }
    if (pts.length < targets.length) {
      if (!area.scatterRadiusM) {
        return {
          ok: false,
          error:
            "Uvnitř hranice se nepodařilo umístit všechny kusy. Nastav i poloměr rozhozu jako záložní.",
        };
      }
      pts.push(
        ...scatterPoints(
          area.centerLat,
          area.centerLng,
          area.scatterRadiusM,
          targets.length - pts.length,
        ),
      );
    }
    await prisma.$transaction(
      targets.map((t, i) =>
        prisma.dropItem.update({
          where: { id: t.id },
          data: { lat: pts[i]!.lat, lng: pts[i]!.lng },
        }),
      ),
    );
    revalidate(campaignId);
    return { ok: true, placed: targets.length, inBoundary };
  } catch (e) {
    return { ok: false, error: msg(e, "Rozhoz selhal") };
  }
}

/** Sets one card's position — used by clicking the map. */
/** Clears a card's position — it goes back to the "still to place" queue
 *  without losing anything else about it. */
export async function clearItemPositionAction(
  campaignId: number,
  itemId: number,
): Promise<VoidResult> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  try {
    await prisma.dropItem.update({
      where: { id: itemId },
      data: { lat: null, lng: null },
    });
    revalidate(campaignId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: msg(e, "Smazání pozice selhalo") };
  }
}

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
/**
 * One card's code, exactly as it will print.
 *
 * Title, caption and every look setting resolve item-over-campaign here
 * and nowhere else, so the grid preview, the single preview and the print
 * sheet cannot drift apart — the whole point of previewing in centimetres
 * is that what you see is what comes out of the printer.
 */
function renderItem(item: DropItemWithCampaign): {
  id: number;
  findId: number;
  svg: string;
  url: string;
  sizeCm: number;
} {
  const url = dropLandingUrl(item.token);
  const o = mergeDropQrOptions(item.campaign.qrOptions, item.qrOptions);
  return {
    id: item.id,
    findId: item.findId,
    url,
    sizeCm: o.sizeCm ?? DROP_SIZE_DEFAULT_CM,
    svg: renderFindQrSvg(item.findId, {
      url,
      header: item.qrTitle ?? item.campaign.qrTitle ?? `🍀 #${item.findId}`,
      footer: item.qrCaption ?? item.campaign.qrCaption ?? null,
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

type DropItemWithCampaign = Prisma.DropItemGetPayload<{
  include: { campaign: true };
}>;

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
    const r = renderItem(item);
    return { ok: true, url: r.url, svg: r.svg };
  } catch (e) {
    return { ok: false, error: msg(e, "Vykreslení QR selhalo") };
  }
}

/**
 * Renders a whole page of cards in one round trip.
 *
 * The grid used to fire one action per card, which is fine for nine and
 * silly for a hundred and eleven — 111 requests before the page settles.
 * Chunked by the caller so a huge set still streams in.
 */
export async function renderDropQrBatchAction(
  itemIds: number[],
): Promise<
  Result<{
    items: Array<{ id: number; findId: number; svg: string; sizeCm: number }>;
  }>
> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  const ids = (Array.isArray(itemIds) ? itemIds : [])
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 60);
  if (ids.length === 0) return { ok: true, items: [] };
  try {
    const rows = await prisma.dropItem.findMany({
      where: { id: { in: ids } },
      include: { campaign: true },
      orderBy: { findId: "asc" },
    });
    return {
      ok: true,
      items: rows.map((item) => {
        const { id, findId, svg, sizeCm } = renderItem(item);
        return { id, findId, svg, sizeCm };
      }),
    };
  } catch (e) {
    return { ok: false, error: msg(e, "Vykreslení QR selhalo") };
  }
}

function msg(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

// -------------------------------------------------------------------- xlsx

export interface ImportReport {
  matched: number;
  changed: number;
  /** Fields cleared back to "inherit from the campaign". */
  cleared: number;
  unknownFinds: number[];
  unknownAreas: string[];
  unknownPlacers: string[];
  errors: string[];
}

/**
 * Applies an edited export back onto the campaign.
 *
 * Deliberately single-phase but loud: nothing is deleted, every change is
 * counted and every rejected row is named, so a mistake shows up in the
 * report instead of being discovered weeks later. Blocking problems (a
 * bad status, an unreadable coordinate, a duplicate row) stop the whole
 * import — a half-applied spreadsheet is worse than none.
 *
 * A crew name outside the roster is allowed but reported: the roster is a
 * convenience list, not a constraint, and refusing an import because
 * somebody typed a nickname would be the wrong trade.
 */
export async function importDropXlsxAction(
  campaignId: number,
  form: FormData,
): Promise<Result<{ report: ImportReport }>> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Vyber soubor .xlsx" };
  }
  if (file.size > 10 * 1024 * 1024) {
    return { ok: false, error: "Soubor je větší než 10 MB" };
  }

  try {
    const parsed = await parseDropXlsx(await file.arrayBuffer());
    if (parsed.errors.length > 0) {
      return {
        ok: true,
        report: {
          matched: 0,
          changed: 0,
          cleared: 0,
          unknownFinds: [],
          unknownAreas: [],
          unknownPlacers: [],
          errors: parsed.errors.slice(0, 50),
        },
      };
    }

    const [items, areas, campaign] = await Promise.all([
      prisma.dropItem.findMany({ where: { campaignId } }),
      prisma.dropArea.findMany({ where: { campaignId } }),
      prisma.dropCampaign.findUnique({
        where: { id: campaignId },
        select: { placers: true },
      }),
    ]);
    const byFind = new Map(items.map((i) => [i.findId, i]));
    const areaByName = new Map(
      areas.map((a) => [a.name.trim().toLowerCase(), a.id]),
    );
    const roster = new Set(campaign?.placers ?? []);

    const report: ImportReport = {
      matched: 0,
      changed: 0,
      cleared: 0,
      unknownFinds: [],
      unknownAreas: [],
      unknownPlacers: [],
      errors: [],
    };

    const updates: Array<{ id: number; data: Record<string, unknown> }> = [];

    for (const row of parsed.rows) {
      const item = byFind.get(row.findId);
      if (!item) {
        report.unknownFinds.push(row.findId);
        continue;
      }
      report.matched += 1;
      const data: Record<string, unknown> = {};
      const v = row.values;

      const setText = (
        key:
          | "headingCs"
          | "headingEn"
          | "bodyCs"
          | "bodyEn"
          | "bonusCs"
          | "bonusEn"
          | "qrTitle"
          | "qrCaption"
          | "hintCs"
          | "hintEn",
      ) => {
        if (v[key] === undefined) return;
        const next = v[key] === "" ? null : v[key]!;
        const prev = (item as Record<string, unknown>)[key] ?? null;
        if (next !== prev) {
          data[key] = next;
          if (next === null) report.cleared += 1;
        }
      };
      (
        [
          "headingCs",
          "headingEn",
          "bodyCs",
          "bodyEn",
          "bonusCs",
          "bonusEn",
          "qrTitle",
          "qrCaption",
          "hintCs",
          "hintEn",
        ] as const
      ).forEach(setText);

      if (v.sizeCm !== undefined) {
        const bag = withSizeCm(
          item.qrOptions,
          v.sizeCm === null ? "" : String(v.sizeCm),
        );
        const before = readDropQrOptions(item.qrOptions).sizeCm;
        const after = readDropQrOptions(bag).sizeCm;
        if (before !== after) {
          data.qrOptions = Object.keys(bag).length > 0 ? bag : Prisma.DbNull;
          if (after === undefined) report.cleared += 1;
        }
      }

      if (v.area !== undefined) {
        if (v.area === "") {
          if (item.areaId !== null) data.areaId = null;
        } else {
          const areaId = areaByName.get(v.area.trim().toLowerCase());
          if (areaId === undefined) {
            if (!report.unknownAreas.includes(v.area)) {
              report.unknownAreas.push(v.area);
            }
          } else if (areaId !== item.areaId) {
            data.areaId = areaId;
          }
        }
      }

      if (v.placedBy !== undefined) {
        const next = v.placedBy === "" ? null : v.placedBy;
        if (next !== null && !roster.has(next)) {
          if (!report.unknownPlacers.includes(next)) {
            report.unknownPlacers.push(next);
          }
        }
        if (next !== (item.placedBy ?? null)) data.placedBy = next;
      }

      if (v.status !== undefined && v.status !== item.status) {
        data.status = v.status;
      }
      if (v.hintPublished !== undefined && v.hintPublished !== item.hintPublished) {
        data.hintPublished = v.hintPublished;
      }
      if (v.lat !== undefined && v.lng !== undefined) {
        // Compare at the precision the export writes (6 decimals ≈ 11 cm).
        // A click on the map stores full double precision, so a plain !==
        // would flag every untouched row as changed the moment it made a
        // round trip through the sheet.
        const same =
          v.lat === null || v.lng === null || item.lat === null || item.lng === null
            ? v.lat === item.lat && v.lng === item.lng
            : formatGpsDecimal(v.lat, v.lng) ===
              formatGpsDecimal(item.lat, item.lng);
        if (!same) {
          data.lat = v.lat;
          data.lng = v.lng;
        }
      }

      if (Object.keys(data).length > 0) {
        updates.push({ id: item.id, data });
        report.changed += 1;
      }
    }

    if (updates.length > 0) {
      // One transaction: a spreadsheet either lands whole or not at all.
      await prisma.$transaction(
        updates.map((u) =>
          prisma.dropItem.update({ where: { id: u.id }, data: u.data }),
        ),
      );
      await appendAudit({
        action: "settings.update",
        ip: await getRequestIp(),
        details: {
          drops: "xlsx-import",
          campaignId,
          changed: report.changed,
          cleared: report.cleared,
        },
      });
      revalidate(campaignId);
    }

    return { ok: true, report };
  } catch (e) {
    return { ok: false, error: msg(e, "Import selhal") };
  }
}
