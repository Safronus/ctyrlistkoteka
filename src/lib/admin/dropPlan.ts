import { Prisma } from "@/generated/prisma/client";
import { formatGpsDecimal } from "@/lib/parseGps";
import {
  readDropQrOptions,
  DROP_SIZE_DEFAULT_CM,
  DROP_STATUS_LABEL,
} from "@/lib/admin/dropVocab";
import type { ParsedDropRow } from "@/lib/admin/dropXlsx";

/**
 * What a workbook WOULD do to a wave, worked out before anything is
 * written.
 *
 * Lifted out of the upload action so the manual upload and the Google
 * Sheets sync share one set of rules. They had better: both decide the
 * same delicate question — is this cell an edit, or is it just showing
 * what the card already says — and two copies of that logic would
 * eventually disagree, in a way nobody would notice until a wave stopped
 * inheriting its campaign's text.
 *
 * Pure: no database, no clock, no writes. The caller applies the plan.
 */

export interface DropPlanReport {
  matched: number;
  changed: number;
  cleared: number;
  unknownFinds: number[];
  unknownAreas: string[];
  unknownPlacers: string[];
  /** Fields skipped because they carry a superseded campaign default. */
  staleFields: string[];
  errors: string[];
}

/** One human-readable difference, for the preview. */
export interface DropChange {
  findId: number;
  field: string;
  before: string;
  after: string;
}

export interface DropPlan {
  updates: Array<{ id: number; data: Record<string, unknown> }>;
  report: DropPlanReport;
  changes: DropChange[];
}

/** The subset of a DropItem the planner reads. */
export interface PlanItem {
  id: number;
  findId: number;
  areaId: number | null;
  placedBy: string | null;
  lat: number | null;
  lng: number | null;
  status: string;
  hintPublished: boolean;
  qrOptions: unknown;
  headingCs: string | null;
  headingEn: string | null;
  bodyCs: string | null;
  bodyEn: string | null;
  bonusCs: string | null;
  bonusEn: string | null;
  qrTitle: string | null;
  qrCaption: string | null;
  hintCs: string | null;
  hintEn: string | null;
  teamNote: string | null;
}

export interface PlanCampaign {
  placers: string[];
  qrOptions: unknown;
  headingCs: string | null;
  headingEn: string | null;
  bodyCs: string | null;
  bodyEn: string | null;
  bonusCs: string | null;
  bonusEn: string | null;
  qrTitle: string | null;
  qrCaption: string | null;
  hintCs: string | null;
  hintEn: string | null;
  /**
   * The campaign defaults as of the last export.
   *
   * The safety net for the one trap in "the sheet wins": change a default
   * text in the admin and the sheet still carries the OLD one, pre-filled
   * into all hundred rows — so the next sync would push the superseded
   * text back as a hundred overrides. A value equal to a default that has
   * since been replaced is therefore treated as "the sheet is out of
   * date", left alone, and reported.
   */
  exportedDefaults?: Record<string, string | null> | null;
}

const TEXT_KEYS = [
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
] as const;

type TextKey = (typeof TEXT_KEYS)[number];

const FIELD_LABEL: Record<string, string> = {
  headingCs: "Nadpis CZ",
  headingEn: "Nadpis EN",
  bodyCs: "Text CZ",
  bodyEn: "Text EN",
  bonusCs: "Bonus CZ",
  bonusEn: "Bonus EN",
  qrTitle: "Nad QR kódem",
  qrCaption: "Pod QR kódem",
  hintCs: "Nápověda CZ",
  hintEn: "Nápověda EN",
  sizeCm: "Velikost tisku",
  area: "Oblast",
  placedBy: "Kdo umísťuje",
  status: "Stav",
  gps: "GPS",
  hintPublished: "Nápověda zveřejněná",
  teamNote: "Poznámka týmu",
};

export function planDropImport(
  rows: ParsedDropRow[],
  items: PlanItem[],
  campaign: PlanCampaign,
  areas: Array<{ id: number; name: string }>,
): DropPlan {
  const byFind = new Map(items.map((i) => [i.findId, i]));
  const areaById = new Map(areas.map((a) => [a.id, a.name]));
  const areaByName = new Map(
    areas.map((a) => [a.name.trim().toLowerCase(), a.id]),
  );
  const roster = new Set(campaign.placers);
  const campaignSizeCm =
    readDropQrOptions(campaign.qrOptions).sizeCm ?? DROP_SIZE_DEFAULT_CM;

  const report: DropPlanReport = {
    matched: 0,
    changed: 0,
    cleared: 0,
    unknownFinds: [],
    unknownAreas: [],
    unknownPlacers: [],
    staleFields: [],
    errors: [],
  };
  const updates: DropPlan["updates"] = [];
  const changes: DropChange[] = [];

  for (const row of rows) {
    const item = byFind.get(row.findId);
    if (!item) {
      report.unknownFinds.push(row.findId);
      continue;
    }
    report.matched += 1;
    const data: Record<string, unknown> = {};
    const v = row.values;
    const note = (field: string, before: unknown, after: unknown) =>
      changes.push({
        findId: row.findId,
        field: FIELD_LABEL[field] ?? field,
        before: show(before),
        after: show(after),
      });

    // ---------------------------------------------------------- texts
    for (const key of TEXT_KEYS) {
      const typed = v[key];
      if (typed === undefined) continue;
      const inherited = (campaign[key] ?? "").trim();
      const superseded = (campaign.exportedDefaults?.[key] ?? "").trim();

      // Out-of-date sheet: this cell matches what the campaign USED to
      // say, not what it says now. Applying it would undo the edit that
      // was just made in the admin.
      if (
        typed.trim() !== "" &&
        typed.trim() !== inherited &&
        superseded !== "" &&
        typed.trim() === superseded
      ) {
        const label = FIELD_LABEL[key] ?? key;
        if (!report.staleFields.includes(label)) report.staleFields.push(label);
        continue;
      }

      const next = typed === "" || typed.trim() === inherited ? null : typed;
      const prev = item[key] ?? null;
      if (next !== prev) {
        data[key] = next;
        if (next === null) report.cleared += 1;
        note(key, prev, next);
      }
    }

    // The crew's note is the one text with no campaign default behind
    // it — nothing to inherit, so it is a plain overwrite.
    if (v.note !== undefined) {
      const next = v.note.trim() === "" ? null : v.note;
      if (next !== (item.teamNote ?? null)) {
        data.teamNote = next;
        note("teamNote", item.teamNote, next);
      }
    }

    // ------------------------------------------------------ card look
    const bag: Record<string, unknown> = {
      ...(item.qrOptions && typeof item.qrOptions === "object"
        ? (item.qrOptions as Record<string, unknown>)
        : {}),
    };
    const bagBefore = JSON.stringify(bag);
    const sizeBefore = readDropQrOptions(item.qrOptions).sizeCm;

    if (v.sizeCm !== undefined) {
      if (v.sizeCm === null || v.sizeCm === campaignSizeCm) delete bag.sizeCm;
      else bag.sizeCm = v.sizeCm;
    }
    // A title typed into the sheet has to turn the title ON as well, or
    // the text lands in the database and the card looks unchanged.
    if (typeof data.qrTitle === "string" && data.qrTitle) {
      bag.titleMode = "custom";
    }
    if (typeof data.qrCaption === "string" && data.qrCaption) {
      bag.captionMode = "custom";
    }

    if (JSON.stringify(bag) !== bagBefore) {
      const sizeAfter = readDropQrOptions(bag).sizeCm;
      data.qrOptions =
        Object.keys(bag).length > 0
          ? (bag as Prisma.InputJsonObject)
          : Prisma.DbNull;
      if (sizeBefore !== undefined && sizeAfter === undefined) {
        report.cleared += 1;
      }
      if (sizeBefore !== sizeAfter) {
        note("sizeCm", sizeBefore ?? "ze sady", sizeAfter ?? "ze sady");
      }
    }

    // ----------------------------------------------------------- area
    //
    // A card that changes town leaves its old chain behind: the "řetězec
    // čtyřlístků" is an order WITHIN one area, so a stale position would
    // otherwise splice the card into the new area's hunt at whatever
    // number it happened to hold.
    if (v.area !== undefined) {
      if (v.area === "") {
        if (item.areaId !== null) {
          data.areaId = null;
          data.chainOrder = null;
          note("area", areaById.get(item.areaId), null);
        }
      } else {
        const areaId = areaByName.get(v.area.trim().toLowerCase());
        if (areaId === undefined) {
          if (!report.unknownAreas.includes(v.area)) {
            report.unknownAreas.push(v.area);
          }
        } else if (areaId !== item.areaId) {
          data.areaId = areaId;
          data.chainOrder = null;
          note(
            "area",
            item.areaId === null ? null : areaById.get(item.areaId),
            areaById.get(areaId),
          );
        }
      }
    }

    // ------------------------------------------------------- placedBy
    if (v.placedBy !== undefined) {
      const next = v.placedBy === "" ? null : v.placedBy;
      if (next !== null && !roster.has(next)) {
        if (!report.unknownPlacers.includes(next)) {
          report.unknownPlacers.push(next);
        }
      }
      if (next !== (item.placedBy ?? null)) {
        data.placedBy = next;
        note("placedBy", item.placedBy, next);
      }
    }

    // --------------------------------------------------------- status
    if (v.status !== undefined && v.status !== item.status) {
      data.status = v.status;
      note(
        "status",
        DROP_STATUS_LABEL[item.status as keyof typeof DROP_STATUS_LABEL],
        DROP_STATUS_LABEL[v.status],
      );
    }

    if (
      v.hintPublished !== undefined &&
      v.hintPublished !== item.hintPublished
    ) {
      data.hintPublished = v.hintPublished;
      note("hintPublished", item.hintPublished ? "ano" : "ne", v.hintPublished ? "ano" : "ne");
    }

    // ------------------------------------------------------------ gps
    if (v.lat !== undefined && v.lng !== undefined) {
      // Compared at the precision the export writes (6 decimals ≈ 11 cm):
      // a click on the map stores full double precision, so a plain !==
      // would flag every mapped card as changed the moment it made a
      // round trip through the sheet.
      const same =
        v.lat === null || v.lng === null || item.lat === null || item.lng === null
          ? v.lat === item.lat && v.lng === item.lng
          : formatGpsDecimal(v.lat, v.lng) ===
            formatGpsDecimal(item.lat, item.lng);
      if (!same) {
        data.lat = v.lat;
        data.lng = v.lng;
        note(
          "gps",
          item.lat !== null && item.lng !== null
            ? formatGpsDecimal(item.lat, item.lng)
            : null,
          v.lat !== null && v.lng !== null
            ? formatGpsDecimal(v.lat, v.lng)
            : null,
        );
      }
    }

    if (Object.keys(data).length > 0) {
      updates.push({ id: item.id, data });
      report.changed += 1;
    }
  }

  return { updates, report, changes };
}

/** Short, readable rendering of a value for the diff. */
function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "— prázdné —";
  const s = String(v).replace(/\s+/g, " ").trim();
  return s.length > 70 ? `${s.slice(0, 70)}…` : s;
}

/** The campaign fields whose values the sheet pre-fills, snapshotted at
 *  export so a later sync can spot a sheet that predates an edit. */
export function campaignDefaultsSnapshot(
  c: Record<TextKey, string | null>,
): Record<string, string | null> {
  return Object.fromEntries(TEXT_KEYS.map((k) => [k, c[k] ?? null]));
}
