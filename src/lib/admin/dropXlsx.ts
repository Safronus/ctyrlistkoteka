import ExcelJS from "exceljs";
import { DropStatus } from "@/generated/prisma/client";
import { parseGps, formatGpsDecimal } from "@/lib/parseGps";
import { DROP_STATUS_LABEL, DROP_STATUS_ORDER } from "./dropVocab";

/**
 * Round-trip of a whole wave through one spreadsheet.
 *
 * The point is bulk editing that no web form is good at: retyping a
 * hundred hints, pasting coordinates collected on a phone, splitting the
 * crew across the batch. Export, edit in Excel/Numbers, upload back.
 *
 * Two rules make the round trip safe rather than clever:
 *   - The FIND NUMBER is the key. Rows are matched on it; a row whose
 *     number isn't in the set is reported, never silently created.
 *   - An empty cell means "inherit from the campaign", exactly as an
 *     empty field does in the admin. That keeps the export→import cycle
 *     lossless — what you see in the sheet is what the card has.
 *
 * The last three columns are read-only context (landing URL, scans, when
 * it was found); they are ignored on import so pasting an older export
 * can't resurrect stale scan counts.
 */

export const DROP_SHEET_NAME = "Kusy";

/** Column order is also the import contract — headers are matched by
 *  name, so a reordered or partially deleted sheet still works. */
const COLUMNS = [
  { key: "findId", header: "Číslo nálezu", width: 14 },
  { key: "area", header: "Oblast", width: 16 },
  { key: "status", header: "Stav", width: 14 },
  { key: "placedBy", header: "Kdo umísťuje", width: 18 },
  { key: "gps", header: "GPS", width: 26 },
  { key: "headingCs", header: "Nadpis CZ", width: 28 },
  { key: "headingEn", header: "Nadpis EN", width: 28 },
  { key: "bodyCs", header: "Text CZ", width: 40 },
  { key: "bodyEn", header: "Text EN", width: 40 },
  { key: "bonusCs", header: "Bonus CZ", width: 32 },
  { key: "bonusEn", header: "Bonus EN", width: 32 },
  { key: "qrTitle", header: "Titulek QR", width: 20 },
  { key: "hintCs", header: "Nápověda CZ", width: 32 },
  { key: "hintEn", header: "Nápověda EN", width: 32 },
  { key: "hintPublished", header: "Nápověda zveřejněná", width: 20 },
  { key: "landingUrl", header: "Odkaz (jen ke čtení)", width: 46 },
  { key: "scans", header: "Naskenování (jen ke čtení)", width: 24 },
  { key: "foundAt", header: "Nalezeno (jen ke čtení)", width: 22 },
] as const;

const READ_ONLY = new Set(["landingUrl", "scans", "foundAt"]);

export interface DropXlsxRow {
  findId: number;
  area: string;
  status: DropStatus;
  placedBy: string;
  lat: number | null;
  lng: number | null;
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
  landingUrl: string;
  scans: number;
  foundAt: string;
}

export async function buildDropXlsx(
  campaignName: string,
  areaNames: string[],
  placers: string[],
  rows: DropXlsxRow[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Čtyřlístkotéka";
  const ws = wb.addWorksheet(DROP_SHEET_NAME);

  ws.columns = COLUMNS.map((c) => ({
    key: c.key,
    header: c.header,
    width: c.width,
  }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];

  for (const r of rows) {
    ws.addRow({
      findId: r.findId,
      area: r.area,
      status: DROP_STATUS_LABEL[r.status],
      placedBy: r.placedBy,
      gps: r.lat !== null && r.lng !== null ? formatGpsDecimal(r.lat, r.lng) : "",
      headingCs: r.headingCs,
      headingEn: r.headingEn,
      bodyCs: r.bodyCs,
      bodyEn: r.bodyEn,
      bonusCs: r.bonusCs,
      bonusEn: r.bonusEn,
      qrTitle: r.qrTitle,
      hintCs: r.hintCs,
      hintEn: r.hintEn,
      hintPublished: r.hintPublished ? "ano" : "ne",
      landingUrl: r.landingUrl,
      scans: r.scans,
      foundAt: r.foundAt,
    });
  }

  // Dropdowns on the columns with a closed vocabulary, so the sheet
  // teaches its own valid values instead of relying on the operator
  // remembering them.
  const last = Math.max(2, rows.length + 1);
  const statusList = `"${DROP_STATUS_ORDER.map((s) => DROP_STATUS_LABEL[s]).join(",")}"`;
  for (let i = 2; i <= last; i++) {
    ws.getCell(`C${i}`).dataValidation = {
      type: "list",
      allowBlank: false,
      formulae: [statusList],
    };
    ws.getCell(`O${i}`).dataValidation = {
      type: "list",
      allowBlank: false,
      formulae: ['"ano,ne"'],
    };
    if (placers.length > 0 && placers.join(",").length < 250) {
      ws.getCell(`D${i}`).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`"${placers.join(",")}"`],
      };
    }
    if (areaNames.length > 0 && areaNames.join(",").length < 250) {
      ws.getCell(`B${i}`).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`"${areaNames.join(",")}"`],
      };
    }
  }

  // A second sheet as the manual — the operator opening this in six
  // months shouldn't have to guess what an empty cell does.
  const help = wb.addWorksheet("Návod");
  help.columns = [{ width: 110 }];
  for (const line of [
    `Sada: ${campaignName}`,
    "",
    "Uprav list „Kusy“ a nahraj soubor zpět v /admin/qr → Darování ve světě.",
    "",
    "• Řádky se párují podle „Číslo nálezu“. Číslo, které v sadě není, se přeskočí a nahlásí.",
    "• Prázdná buňka u textu znamená „převzít ze sady“ — stejně jako prázdné pole v adminu.",
    "• GPS bere desetinné stupně (49.2245, 17.6712), DMS i odkaz z Mapy.cz nebo Google Maps.",
    "• Prázdná GPS pozici smaže.",
    "• Poslední tři sloupce jsou jen ke čtení a při importu se ignorují.",
    "• Stav: " + DROP_STATUS_ORDER.map((s) => DROP_STATUS_LABEL[s]).join(", "),
  ]) {
    help.addRow([line]);
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

export interface ParsedDropRow {
  findId: number;
  /** Only keys actually present as columns in the sheet. */
  values: Partial<{
    area: string;
    status: DropStatus;
    placedBy: string;
    lat: number | null;
    lng: number | null;
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
  }>;
}

export interface ParseDropXlsxResult {
  rows: ParsedDropRow[];
  /** Blocking problems — the import refuses to run while any remain. */
  errors: string[];
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    // Rich text / formula results / hyperlinks.
    if ("richText" in v && Array.isArray(v.richText)) {
      return v.richText.map((t) => t.text).join("");
    }
    if ("text" in v && typeof v.text === "string") return v.text;
    if ("result" in v) return String(v.result ?? "");
    if (v instanceof Date) return v.toISOString();
  }
  return String(v);
}

const STATUS_BY_LABEL = new Map<string, DropStatus>(
  DROP_STATUS_ORDER.map((s) => [DROP_STATUS_LABEL[s].toLowerCase(), s]),
);

export async function parseDropXlsx(
  data: ArrayBuffer,
): Promise<ParseDropXlsxResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  const ws = wb.getWorksheet(DROP_SHEET_NAME) ?? wb.worksheets[0];
  if (!ws) return { rows: [], errors: ["Soubor neobsahuje žádný list."] };

  // Headers are matched by NAME, so reordering columns in Excel — which
  // people do — doesn't silently shift every value one column over.
  const headerRow = ws.getRow(1);
  const colByKey = new Map<string, number>();
  headerRow.eachCell((cell, col) => {
    const text = cellText(cell.value).trim().toLowerCase();
    const match = COLUMNS.find((c) => c.header.toLowerCase() === text);
    if (match && !READ_ONLY.has(match.key)) colByKey.set(match.key, col);
  });

  const errors: string[] = [];
  if (!colByKey.has("findId")) {
    return {
      rows: [],
      errors: ['Chybí sloupec „Číslo nálezu“ — bez něj se řádky nespárují.'],
    };
  }

  const rows: ParsedDropRow[] = [];
  const seen = new Set<number>();

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const rawId = cellText(row.getCell(colByKey.get("findId")!).value).trim();
    if (!rawId) continue; // blank line — skip silently
    const findId = Number(rawId);
    if (!Number.isInteger(findId) || findId <= 0) {
      errors.push(`Řádek ${r}: „${rawId}“ není číslo nálezu.`);
      continue;
    }
    if (seen.has(findId)) {
      errors.push(`Řádek ${r}: číslo ${findId} je v souboru dvakrát.`);
      continue;
    }
    seen.add(findId);

    const values: ParsedDropRow["values"] = {};
    const text = (key: string): string | undefined => {
      const col = colByKey.get(key);
      if (col === undefined) return undefined;
      return cellText(row.getCell(col).value).trim();
    };

    for (const key of [
      "headingCs",
      "headingEn",
      "bodyCs",
      "bodyEn",
      "bonusCs",
      "bonusEn",
      "qrTitle",
      "hintCs",
      "hintEn",
      "area",
      "placedBy",
    ] as const) {
      const v = text(key);
      if (v !== undefined) values[key] = v;
    }

    const rawStatus = text("status");
    if (rawStatus !== undefined && rawStatus !== "") {
      const s = STATUS_BY_LABEL.get(rawStatus.toLowerCase());
      if (!s) {
        errors.push(`Řádek ${r}: neznámý stav „${rawStatus}“.`);
      } else {
        values.status = s;
      }
    }

    const rawHint = text("hintPublished");
    if (rawHint !== undefined && rawHint !== "") {
      const yes = ["ano", "yes", "true", "1", "x"].includes(
        rawHint.toLowerCase(),
      );
      const no = ["ne", "no", "false", "0"].includes(rawHint.toLowerCase());
      if (!yes && !no) {
        errors.push(
          `Řádek ${r}: „${rawHint}“ u zveřejnění nápovědy — napiš ano nebo ne.`,
        );
      } else {
        values.hintPublished = yes;
      }
    }

    const rawGps = text("gps");
    if (rawGps !== undefined) {
      if (rawGps === "") {
        values.lat = null;
        values.lng = null;
      } else {
        const p = parseGps(rawGps);
        if (!p) {
          errors.push(`Řádek ${r}: souřadnice „${rawGps}“ se nepodařilo přečíst.`);
        } else {
          values.lat = p.lat;
          values.lng = p.lng;
        }
      }
    }

    rows.push({ findId, values });
  }

  return { rows, errors };
}
