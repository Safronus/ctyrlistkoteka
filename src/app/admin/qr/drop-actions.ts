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
import { archiveDropXlsx } from "@/lib/admin/dropXlsxArchive";
import { renderFindQrSvg } from "@/lib/admin/qr";
import {
  dropLandingUrl,
  mergeDropQrOptions,
  readDropQrOptions,
  resolveQrLines,
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
  /** Wave-wide default hunt hint; a card may override it. */
  hintCs: string;
  hintEn: string;
  design: QrDesignInput;
  /** Newline- or comma-separated crew names. */
  placers: string;
}

/** Everything about how a card LOOKS, as the forms send it. */
export interface QrDesignInput {
  titleMode: string;
  captionMode: string;
  sizeCm: string;
  density: string;
  theme: string;
  moduleStyle: string;
  center: string;
  centerScale: string;
  border: string;
  borderRadius: string;
  borderColor: string;
}

/**
 * Turns a form's design into the stored option bag.
 *
 * Merged onto whatever is already there rather than replacing it, so a
 * key this build doesn't know about (an older or newer field) survives a
 * save instead of being quietly dropped. Validation happens on READ via
 * `readDropQrOptions`, which is the single gate every consumer passes.
 */
function designToBag(
  existing: unknown,
  input: QrDesignInput,
): Prisma.InputJsonObject {
  const bag: Record<string, unknown> = {
    ...(existing && typeof existing === "object"
      ? (existing as Record<string, unknown>)
      : {}),
  };
  const size = clampDropSizeCm(String(input.sizeCm ?? "").replace(",", "."));
  if (size === undefined) delete bag.sizeCm;
  else bag.sizeCm = size;
  for (const key of [
    "titleMode",
    "captionMode",
    "density",
    "theme",
    "moduleStyle",
    "center",
    "centerScale",
    "border",
    "borderRadius",
    "borderColor",
  ] as const) {
    const v = str(input[key], 40);
    if (v) bag[key] = v;
    else delete bag[key];
  }
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
        hintCs: nullable(input.hintCs, 5_000),
        hintEn: nullable(input.hintEn, 5_000),
        qrOptions: designToBag(null, input.design),
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
        hintCs: nullable(input.hintCs, 5_000),
        hintEn: nullable(input.hintEn, 5_000),
        qrOptions: designToBag(current?.qrOptions, input.design),
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
  /** When false the card has NO option bag of its own and follows the
   *  wave; when true `design` is stored as its override. */
  ownDesign: boolean;
  design: QrDesignInput;
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
    // The bag is an override LAYER. Without "own design" ticked it must
    // stay absent rather than hold a copy of the campaign's values —
    // otherwise editing the wave's look would stop reaching this card.
    const bag = input.ownDesign
      ? designToBag(current?.qrOptions, input.design)
      : null;
    await prisma.dropItem.update({
      where: { id: itemId },
      data: {
        qrOptions: bag && Object.keys(bag).length > 0 ? bag : Prisma.DbNull,
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
/**
 * Wipes the scan history of the chosen cards.
 *
 * Undoes everything a scan did, because a scan does three things:
 * `registerDropScan` writes the row, stamps `foundAt` AND flips the
 * status to FOUND. Clearing only the rows would leave a card reading
 * "found, by nobody, at no time" — so the timestamp goes too, and a FOUND
 * status drops back to HIDDEN.
 *
 * Only FOUND is touched. A card still sitting in PREPARED or PRINTED
 * keeps its status, and one the operator marked FOUND by hand goes back
 * to HIDDEN — which is the honest reading once its evidence is gone.
 *
 * Mainly for the test scans made while a wave is still on the kitchen
 * table, so the counters start from zero when it goes out.
 */
export async function resetScansAction(
  campaignId: number,
  itemIds: number[],
): Promise<Result<{ cleared: number }>> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  const ids = (Array.isArray(itemIds) ? itemIds : []).filter(
    (n) => Number.isInteger(n) && n > 0,
  );
  if (ids.length === 0) return { ok: false, error: "Nic není vybráno" };
  try {
    // Scoped by campaign as well as id: an id from another wave pasted in
    // by a stale client must not reach across.
    const mine = await prisma.dropItem.findMany({
      where: { id: { in: ids }, campaignId },
      select: { id: true },
    });
    const mineIds = mine.map((m) => m.id);
    if (mineIds.length === 0) return { ok: false, error: "Nic k vynulování" };
    const [deleted] = await prisma.$transaction([
      prisma.dropScan.deleteMany({ where: { itemId: { in: mineIds } } }),
      prisma.dropItem.updateMany({
        where: { id: { in: mineIds } },
        data: { foundAt: null },
      }),
      prisma.dropItem.updateMany({
        where: { id: { in: mineIds }, status: DropStatus.FOUND },
        data: { status: DropStatus.HIDDEN },
      }),
    ]);
    await appendAudit({
      action: "qr.scans_reset",
      ip: await getRequestIp(),
      details: { drops: "reset-scans", campaignId, items: mineIds.length },
    });
    revalidate(campaignId);
    return { ok: true, cleared: deleted.count };
  } catch (e) {
    return { ok: false, error: msg(e, "Vynulování skenů selhalo") };
  }
}

/** Takes the position off every placed card of an area at once. */
export async function clearAreaPositionsAction(
  campaignId: number,
  areaId: number,
): Promise<Result<{ cleared: number }>> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  try {
    const res = await prisma.dropItem.updateMany({
      where: { campaignId, areaId, lat: { not: null } },
      data: { lat: null, lng: null },
    });
    await appendAudit({
      action: "settings.update",
      ip: await getRequestIp(),
      details: { drops: "clear-positions", campaignId, areaId, count: res.count },
    });
    revalidate(campaignId);
    return { ok: true, cleared: res.count };
  } catch (e) {
    return { ok: false, error: msg(e, "Smazání pozic selhalo") };
  }
}

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

type DropItemWithCampaign = Prisma.DropItemGetPayload<{
  include: { campaign: true };
}>;

/**
 * Draws a card from an unsaved design, for the live preview in the forms.
 *
 * Deliberately the same renderer the grid and the print sheet use — a
 * preview drawn any other way would eventually stop matching what comes
 * out of the printer, which is the one thing it exists to promise. The
 * URL is a placeholder of realistic LENGTH, because a QR's module count
 * follows how much it encodes.
 */
export async function previewDropQrAction(
  findId: number,
  design: QrDesignInput & { title?: string; caption?: string },
): Promise<Result<{ svg: string }>> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  try {
    const bag = designToBag(null, design);
    const o = readDropQrOptions(bag);
    const id = Number.isInteger(findId) && findId > 0 ? findId : 30001;
    const lines = resolveQrLines(
      o,
      id,
      str(design.title ?? "", 200) || null,
      null,
      str(design.caption ?? "", 200) || null,
      null,
    );
    return {
      ok: true,
      svg: renderFindQrSvg(id, {
        // Same shape and length as a real landing URL, so the preview's
        // module count matches the printed one.
        url: dropLandingUrl("00000000-0000-4000-8000-000000000000"),
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
  } catch (e) {
    return { ok: false, error: msg(e, "Náhled selhal") };
  }
}

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
    const raw = Buffer.from(await file.arrayBuffer());
    const parsed = await parseDropXlsx(
      raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
    );
    if (parsed.errors.length > 0) {
      // Archived even when it lands nowhere: a file somebody spent an
      // evening on and that bounced is exactly the one worth keeping.
      await archiveDropXlsx(
        campaignId,
        raw,
        { originalName: file.name, matched: 0, changed: 0, blocked: true },
        new Date(),
      );
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
      prisma.dropCampaign.findUnique({ where: { id: campaignId } }),
    ]);
    const byFind = new Map(items.map((i) => [i.findId, i]));
    const areaByName = new Map(
      areas.map((a) => [a.name.trim().toLowerCase(), a.id]),
    );
    const roster = new Set(campaign?.placers ?? []);
    const campaignSizeCm =
      readDropQrOptions(campaign?.qrOptions).sizeCm ?? DROP_SIZE_DEFAULT_CM;

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

      // The sheet arrives PRE-FILLED with what each card actually says,
      // so "same as the campaign" has to keep meaning "still inheriting".
      // Without this every untouched row would come back as a hundred
      // fresh overrides and the wave would stop propagating — the same
      // rule the admin dialog uses, for the same reason.
      const campaignText: Record<string, string | null> = {
        headingCs: campaign?.headingCs ?? null,
        headingEn: campaign?.headingEn ?? null,
        bodyCs: campaign?.bodyCs ?? null,
        bodyEn: campaign?.bodyEn ?? null,
        bonusCs: campaign?.bonusCs ?? null,
        bonusEn: campaign?.bonusEn ?? null,
        qrTitle: campaign?.qrTitle ?? null,
        qrCaption: campaign?.qrCaption ?? null,
        hintCs: campaign?.hintCs ?? null,
        hintEn: campaign?.hintEn ?? null,
      };

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
        const typed = v[key]!;
        const inherited = (campaignText[key] ?? "").trim();
        const next = typed === "" || typed.trim() === inherited ? null : typed;
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

      // The sheet edits SIZE and the two card texts; everything else in
      // the card's option bag rides along untouched.
      const bag: Record<string, unknown> = {
        ...(item.qrOptions && typeof item.qrOptions === "object"
          ? (item.qrOptions as Record<string, unknown>)
          : {}),
      };
      const bagBefore = JSON.stringify(bag);

      // Same "equal to the campaign means still inheriting" rule the
      // texts get. The size column arrives pre-filled with the wave's
      // value, so writing it back unconditionally would hand every single
      // card an option bag of its own — and an option bag is what makes a
      // card stop following the wave. An untouched sheet must change
      // nothing.
      if (v.sizeCm !== undefined) {
        if (v.sizeCm === null || v.sizeCm === campaignSizeCm) delete bag.sizeCm;
        else bag.sizeCm = v.sizeCm;
      }

      // Typing a title into the sheet has to TURN THE TITLE ON as well,
      // otherwise the text lands in the column, nothing changes on the
      // card, and there is no way of telling why. Keyed off the OVERRIDE
      // (`data.qrTitle`), not off the cell — a cell merely showing what
      // the wave prints is not a request to pin it.
      if (typeof data.qrTitle === "string" && data.qrTitle) {
        bag.titleMode = "custom";
      }
      if (typeof data.qrCaption === "string" && data.qrCaption) {
        bag.captionMode = "custom";
      }

      if (JSON.stringify(bag) !== bagBefore) {
        const sizeBefore = readDropQrOptions(item.qrOptions).sizeCm;
        const sizeAfter = readDropQrOptions(bag).sizeCm;
        data.qrOptions =
          Object.keys(bag).length > 0
            ? (bag as Prisma.InputJsonObject)
            : Prisma.DbNull;
        if (sizeBefore !== undefined && sizeAfter === undefined) {
          report.cleared += 1;
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

    await archiveDropXlsx(
      campaignId,
      raw,
      {
        originalName: file.name,
        matched: report.matched,
        changed: report.changed,
        blocked: false,
      },
      new Date(),
    );

    return { ok: true, report };
  } catch (e) {
    return { ok: false, error: msg(e, "Import selhal") };
  }
}
