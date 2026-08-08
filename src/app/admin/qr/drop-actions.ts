"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, getRequestIp } from "@/lib/admin/session";
import { appendAudit } from "@/lib/admin/audit";
import { prisma } from "@/lib/db";
import { DropStatus, Prisma } from "@/generated/prisma/client";
import { parseRanges } from "@/lib/parseRanges";
import { parseGps } from "@/lib/parseGps";
import { newDropToken, scatterPoints } from "@/lib/admin/drops";
import { readBoundary, scatterInBoundary } from "@/lib/admin/dropBoundary";
import {
  findBoundaries,
  type BoundaryCandidate,
} from "@/lib/admin/dropNominatim";
import { parseDropXlsx } from "@/lib/admin/dropXlsx";
import {
  planDropImport,
  type DropPlan,
  type DropPlanReport,
  type DropChange,
} from "@/lib/admin/dropPlan";
import {
  parseSheetUrl,
  fetchSheetWorkbook,
  SheetFetchError,
} from "@/lib/admin/dropSheet";
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

/** Re-exported so the panels keep one import site. */
export type ImportReport = DropPlanReport;

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
/**
 * Loads everything the planner needs and works out what a workbook would
 * do. Shared by the manual upload and the Google Sheets sync so the two
 * cannot reach different conclusions about the same file.
 */
async function planFromWorkbook(
  campaignId: number,
  data: ArrayBuffer,
  opts: { tolerant?: boolean } = {},
): Promise<{ ok: false; errors: string[] } | { ok: true; plan: DropPlan }> {
  const parsed = await parseDropXlsx(data);

  // Two different failures wear the same clothes here. A sheet with no
  // usable rows at all — wrong file, missing key column — is fatal either
  // way. A sheet where SOME cell is malformed is not: for a hand-uploaded
  // file we still refuse, because the operator is looking at the result
  // and can fix a typo before retrying; for the shared sheet we do not,
  // because one person's half-typed coordinate must not stop four other
  // people's work, on every poll, silently.
  const fatal = parsed.rows.length === 0 && parsed.errors.length > 0;
  if (fatal || (parsed.errors.length > 0 && !opts.tolerant)) {
    return { ok: false, errors: parsed.errors.slice(0, 50) };
  }
  const [items, areas, campaign] = await Promise.all([
    prisma.dropItem.findMany({ where: { campaignId } }),
    prisma.dropArea.findMany({ where: { campaignId } }),
    prisma.dropCampaign.findUnique({ where: { id: campaignId } }),
  ]);
  if (!campaign) return { ok: false, errors: ["Sada nenalezena"] };
  const plan = planDropImport(
    parsed.rows,
    items,
    {
      ...campaign,
      exportedDefaults: (campaign.exportedDefaults ?? null) as Record<
        string,
        string | null
      > | null,
    },
    areas,
  );
  // Tolerated problems ride along as warnings, so nothing is skipped
  // without being named.
  plan.report.errors = parsed.errors.slice(0, 50);
  return { ok: true, plan };
}

/** Writes a plan. One transaction — a sheet lands whole or not at all. */
async function applyPlan(
  campaignId: number,
  plan: DropPlan,
  source: string,
): Promise<void> {
  if (plan.updates.length === 0) return;
  await prisma.$transaction(
    plan.updates.map((u) =>
      prisma.dropItem.update({ where: { id: u.id }, data: u.data }),
    ),
  );
  await appendAudit({
    action: "settings.update",
    ip: await getRequestIp(),
    details: {
      drops: source,
      campaignId,
      changed: plan.report.changed,
      cleared: plan.report.cleared,
    },
  });
  revalidate(campaignId);
}

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
    const result = await planFromWorkbook(
      campaignId,
      raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
    );

    if (!result.ok) {
      // Archived even when it lands nowhere: a file somebody spent an
      // evening on and that bounced is exactly the one worth keeping.
      await archiveDropXlsx(
        campaignId,
        raw,
        { originalName: file.name, matched: 0, changed: 0, blocked: true },
        new Date(),
      );
      return { ok: true, report: emptyReport(result.errors) };
    }

    // A hand-uploaded file keeps "all or nothing": the operator is
    // looking at the result and can fix a typo before retrying. The
    // background sync deliberately does the opposite — see syncSheet.
    await applyPlan(campaignId, result.plan, "xlsx-import");
    await archiveDropXlsx(
      campaignId,
      raw,
      {
        originalName: file.name,
        matched: result.plan.report.matched,
        changed: result.plan.report.changed,
        blocked: false,
      },
      new Date(),
    );
    return { ok: true, report: result.plan.report };
  } catch (e) {
    return { ok: false, error: msg(e, "Import selhal") };
  }
}

function emptyReport(errors: string[]): ImportReport {
  return {
    matched: 0,
    changed: 0,
    cleared: 0,
    unknownFinds: [],
    unknownAreas: [],
    unknownPlacers: [],
    staleFields: [],
    errors,
  };
}

// ------------------------------------------------------------ Google Sheets

/** Node hands back a Buffer over a pooled allocation; the parser wants
 *  just this file's bytes. */
function toArrayBuffer(b: Buffer): ArrayBuffer {
  const out = new ArrayBuffer(b.byteLength);
  new Uint8Array(out).set(b);
  return out;
}

/**
 * Everything the sheet panel shows about one campaign's link.
 *
 * The URL itself is admin-only data: it is read access to every hiding
 * coordinate in the wave. It travels to the admin page and nowhere else.
 */
export interface SheetStatus {
  url: string | null;
  syncedAt: string | null;
  changedAt: string | null;
  error: string | null;
}

export async function saveSheetUrlAction(
  campaignId: number,
  url: string,
): Promise<Result<{ url: string | null }>> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  const raw = str(url, 500);

  if (!raw) {
    // Clearing the field unhooks the sheet; the wave goes back to being
    // managed in the admin. Nothing about the cards is touched.
    await prisma.dropCampaign.update({
      where: { id: campaignId },
      data: {
        sheetUrl: null,
        sheetHash: null,
        sheetError: null,
        sheetSyncedAt: null,
        sheetChangedAt: null,
      },
    });
    revalidate(campaignId);
    return { ok: true, url: null };
  }

  const ref = parseSheetUrl(raw);
  if (!ref) {
    return {
      ok: false,
      error:
        "To nevypadá na odkaz do Google Sheets. Zkopíruj adresu z prohlížeče, když máš tabulku otevřenou.",
    };
  }

  // Fetch once on save rather than leaving the first failure for the
  // background job: "uloženo" that turns out to mean "unreachable" is
  // exactly the kind of thing nobody notices for a week.
  try {
    await fetchSheetWorkbook(ref);
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof SheetFetchError
          ? e.message
          : msg(e, "Tabulku se nepodařilo stáhnout"),
    };
  }

  await prisma.dropCampaign.update({
    where: { id: campaignId },
    data: { sheetUrl: ref.normalizedUrl, sheetError: null },
  });
  revalidate(campaignId);
  return { ok: true, url: ref.normalizedUrl };
}

export interface SheetPreview {
  changes: DropChange[];
  report: ImportReport;
  /** True when the sheet is byte-identical to the last pull. */
  unchanged: boolean;
  /** True when nothing at all could be read — wrong file, missing key
   *  column. Distinct from "some rows were skipped", which is normal. */
  fatal: boolean;
}

/**
 * Fetches the sheet and works out what it WOULD change, writing nothing.
 *
 * Deliberately separate from applying: the whole reason the sync is
 * one-way and manual is that somebody should see "these twelve cards
 * change, here is old → new" before it happens.
 */
export async function previewSheetSyncAction(
  campaignId: number,
): Promise<Result<SheetPreview>> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  try {
    const campaign = await prisma.dropCampaign.findUnique({
      where: { id: campaignId },
      select: { sheetUrl: true, sheetHash: true },
    });
    const ref = campaign?.sheetUrl ? parseSheetUrl(campaign.sheetUrl) : null;
    if (!ref) return { ok: false, error: "Sada nemá uložený odkaz na tabulku" };

    const fetched = await fetchSheetWorkbook(ref);
    const result = await planFromWorkbook(
      campaignId,
      toArrayBuffer(fetched.bytes),
      { tolerant: true },
    );

    await prisma.dropCampaign.update({
      where: { id: campaignId },
      data: { sheetSyncedAt: new Date(), sheetError: null },
    });

    if (!result.ok) {
      return {
        ok: true,
        fatal: true,
        unchanged: false,
        changes: [],
        report: emptyReport(result.errors),
      };
    }
    return {
      ok: true,
      fatal: false,
      unchanged:
        fetched.hash === campaign?.sheetHash &&
        result.plan.report.changed === 0,
      changes: result.plan.changes,
      report: result.plan.report,
    };
  } catch (e) {
    const error =
      e instanceof SheetFetchError ? e.message : msg(e, "Načtení selhalo");
    await prisma.dropCampaign
      .update({ where: { id: campaignId }, data: { sheetError: error } })
      .catch(() => undefined);
    revalidate(campaignId);
    return { ok: false, error };
  }
}

/** Fetches again and writes. Re-fetched on purpose: the sheet may have
 *  moved on between the preview and the click, and applying a plan built
 *  from a stale download would write something nobody looked at. */
export async function applySheetSyncAction(
  campaignId: number,
): Promise<Result<{ report: ImportReport }>> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  try {
    const campaign = await prisma.dropCampaign.findUnique({
      where: { id: campaignId },
      select: { sheetUrl: true, sheetHash: true },
    });
    const ref = campaign?.sheetUrl ? parseSheetUrl(campaign.sheetUrl) : null;
    if (!ref) return { ok: false, error: "Sada nemá uložený odkaz na tabulku" };

    const fetched = await fetchSheetWorkbook(ref);
    const result = await planFromWorkbook(
      campaignId,
      toArrayBuffer(fetched.bytes),
      { tolerant: true },
    );

    const now = new Date();
    if (!result.ok) {
      await prisma.dropCampaign.update({
        where: { id: campaignId },
        data: { sheetSyncedAt: now, sheetError: result.errors[0] ?? null },
      });
      await archiveDropXlsx(
        campaignId,
        fetched.bytes,
        {
          originalName: "google-sheets.xlsx",
          matched: 0,
          changed: 0,
          blocked: true,
        },
        now,
      );
      revalidate(campaignId);
      return { ok: true, report: emptyReport(result.errors) };
    }

    await applyPlan(campaignId, result.plan, "sheet-sync");
    await prisma.dropCampaign.update({
      where: { id: campaignId },
      data: {
        sheetHash: fetched.hash,
        sheetSyncedAt: now,
        sheetError: null,
        ...(fetched.hash !== campaign?.sheetHash
          ? { sheetChangedAt: now }
          : {}),
      },
    });
    // The pulled workbook is archived exactly like an uploaded one, so a
    // sync is as recoverable as a manual import.
    await archiveDropXlsx(
      campaignId,
      fetched.bytes,
      {
        originalName: "google-sheets.xlsx",
        matched: result.plan.report.matched,
        changed: result.plan.report.changed,
        blocked: false,
      },
      now,
    );
    revalidate(campaignId);
    return { ok: true, report: result.plan.report };
  } catch (e) {
    const error =
      e instanceof SheetFetchError ? e.message : msg(e, "Synchronizace selhala");
    await prisma.dropCampaign
      .update({ where: { id: campaignId }, data: { sheetError: error } })
      .catch(() => undefined);
    revalidate(campaignId);
    return { ok: false, error };
  }
}
