import ExcelJS from "exceljs";
import { DropStatus } from "@/generated/prisma/client";
import { parseGps, formatGpsDecimal } from "@/lib/parseGps";
import {
  DROP_STATUS_LABEL,
  DROP_STATUS_ORDER,
  DROP_SIZE_MAX_CM,
  DROP_SIZE_MIN_CM,
} from "./dropVocab";

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

/** Row holding the field names; row 1 above it holds the group bands. */
const HEADER_ROW = 2;

/** First line of the legend under the data. The importer stops here, so
 *  the explanation block never gets read as rows. */
const LEGEND_SENTINEL = "JAK TABULKU VYPLNIT";

/**
 * The columns, in groups.
 *
 * The sheet is a TEAM document — it goes on a shared drive and several
 * people type into it at once — so the grouping is not decoration. Three
 * kinds of text live here and they end up in completely different places:
 * one is read on a phone after scanning, one is printed on the card, one
 * is a clue published on the find's page. Colour-banded headers say which
 * is which without anyone having to remember.
 */
const GROUPS = {
  id: { label: "Kus", fill: "FFE8EDF3", header: "FFCBD5E1" },
  plan: { label: "Plán", fill: "FFEAF3E8", header: "FFBBD9B4" },
  landing: {
    label: "Text na stránce po naskenování",
    fill: "FFE6F0FA",
    header: "FFB9D5F0",
  },
  card: { label: "Text na kartičce s QR", fill: "FFFDF3E2", header: "FFF2D399" },
  hint: { label: "Nápověda k hledání", fill: "FFFBEDF7", header: "FFEEC2E0" },
  ref: { label: "Jen ke čtení", fill: "FFF3F4F6", header: "FFD1D5DB" },
  free: { label: "Pro tým", fill: "FFFFFBEB", header: "FFFDE68A" },
} as const;

type GroupKey = keyof typeof GROUPS;

const COLUMNS: ReadonlyArray<{
  key: string;
  header: string;
  width: number;
  group: GroupKey;
}> = [
  { key: "ordinal", header: "Pořadí v sadě", width: 13, group: "id" },
  { key: "findId", header: "Číslo čtyřlístku", width: 16, group: "id" },
  { key: "area", header: "Oblast", width: 16, group: "plan" },
  { key: "status", header: "Stav", width: 14, group: "plan" },
  { key: "placedBy", header: "Kdo umísťuje", width: 18, group: "plan" },
  { key: "gps", header: "GPS", width: 26, group: "plan" },
  { key: "headingCs", header: "Nadpis CZ", width: 28, group: "landing" },
  { key: "headingEn", header: "Nadpis EN", width: 28, group: "landing" },
  { key: "bodyCs", header: "Text CZ", width: 40, group: "landing" },
  { key: "bodyEn", header: "Text EN", width: 40, group: "landing" },
  { key: "bonusCs", header: "Bonus CZ", width: 32, group: "landing" },
  { key: "bonusEn", header: "Bonus EN", width: 32, group: "landing" },
  { key: "qrTitle", header: "Nad QR kódem", width: 22, group: "card" },
  { key: "qrCaption", header: "Pod QR kódem", width: 22, group: "card" },
  { key: "sizeCm", header: "Velikost tisku (cm)", width: 18, group: "card" },
  { key: "hintCs", header: "Nápověda CZ", width: 32, group: "hint" },
  { key: "hintEn", header: "Nápověda EN", width: 32, group: "hint" },
  {
    key: "hintPublished",
    header: "Nápověda zveřejněná",
    width: 20,
    group: "hint",
  },
  { key: "landingUrl", header: "Odkaz na stránku kusu", width: 46, group: "ref" },
  { key: "note", header: "Poznámka týmu", width: 40, group: "free" },
];

/** Ignored on import — context to read, not fields to fill in. */
const READ_ONLY = new Set(["landingUrl", "ordinal"]);

/**
 * Colour-bands each group and writes the group names above the headers.
 *
 * Two header rows, not one: row 1 says WHERE the text ends up, row 2
 * names the field. Somebody opening this on a shared drive should be able
 * to tell the landing-page text from what is printed on the card without
 * being told.
 */
function paintGroups(ws: ExcelJS.Worksheet, rowCount: number): void {
  ws.spliceRows(1, 0, []);
  const bandRow = ws.getRow(1);
  const headRow = ws.getRow(2);
  headRow.font = { bold: true };
  headRow.alignment = { vertical: "middle", wrapText: true };

  let start = 1;
  for (let i = 0; i < COLUMNS.length; i++) {
    const col = COLUMNS[i]!;
    const next = COLUMNS[i + 1];
    const g = GROUPS[col.group];
    for (const row of [bandRow, headRow]) {
      const cell = row.getCell(i + 1);
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: row === bandRow ? g.header : g.fill },
      };
      cell.border = {
        left: { style: "thin", color: { argb: "FFFFFFFF" } },
        right: { style: "thin", color: { argb: "FFFFFFFF" } },
      };
    }
    // Tint the data cells too, so a column keeps its meaning as you
    // scroll away from the header.
    for (let r = 3; r < 3 + rowCount; r++) {
      ws.getCell(r, i + 1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: g.fill },
      };
    }
    // One merged label per run of same-group columns.
    if (!next || next.group !== col.group) {
      bandRow.getCell(start).value = g.label;
      if (start !== i + 1) ws.mergeCells(1, start, 1, i + 1);
      const c = bandRow.getCell(start);
      c.font = { bold: true, size: 9 };
      c.alignment = { horizontal: "center", vertical: "middle" };
      start = i + 2;
    }
  }
  bandRow.height = 18;
  headRow.height = 28;
}

/**
 * A legend under the table, in the sheet people actually have open.
 *
 * The "Návod" tab exists, but nobody switches tabs mid-typing — and the
 * questions that come up ("what shape does GPS want?", "is this printed
 * or is it on the phone?") come up while looking at a column. So the
 * answers go directly beneath it.
 */
function appendLegend(ws: ExcelJS.Worksheet, rowCount: number): void {
  const first = HEADER_ROW + rowCount + 2;
  const lines: Array<[string, string]> = [
    [LEGEND_SENTINEL, ""],
    ["", ""],
    [
      "Barevné pruhy nad hlavičkou",
      "říkají, kam který text patří — každá barva je jiné místo.",
    ],
    [
      "Text na stránce po naskenování",
      "Přečte si to na mobilu ten, kdo kartičku najde a naskenuje QR. Na kartičce to není.",
    ],
    [
      "Text na kartičce s QR",
      "To, co se fyzicky vytiskne nad a pod kódem. Krátké — je to kartička, ne leták.",
    ],
    [
      "Nápověda k hledání",
      "Věta na stránce nálezu ve sbírce, aby se dal hledat další kus. Zveřejní se, jen když je „Nápověda zveřejněná“ = ano.",
    ],
    ["", ""],
    ["Buňky jsou předvyplněné", "tím, co kartička říká teď. Přepiš = výjimka jen pro tenhle kus."],
    [
      "Necháš hodnotu beze změny",
      "kus dál sleduje sadu — když se text změní v sadě, propíše se i sem.",
    ],
    ["Vymažeš buňku", "kus se vrátí k textu ze sady."],
    ["", ""],
    ["GPS", "49.2245, 17.6712 · 49°13'28.2\"S 17°40'16.1\"V · nebo odkaz zkopírovaný z Mapy.cz či Google Maps"],
    ["Prázdná GPS", "smaže uloženou pozici úkrytu."],
    [
      `Velikost tisku`,
      `šířka celé kartičky v centimetrech, ${DROP_SIZE_MIN_CM}–${DROP_SIZE_MAX_CM}. Používej desetinnou čárku i tečku.`,
    ],
    ["Stav", DROP_STATUS_ORDER.map((s) => DROP_STATUS_LABEL[s]).join(" · ")],
    ["Kdo umísťuje", "vyber ze seznamu v buňce; jiné jméno se uloží taky, jen se nahlásí."],
    ["Oblast", "musí přesně sedět s názvem oblasti v adminu, jinak se nepřiřadí."],
    ["", ""],
    ["Pořadí v sadě, Odkaz", "jen ke čtení — při nahrání zpátky se ignorují."],
    ["Poznámka týmu", "kam kus přijde, kdo ho veme — načte se a uvidíš ji v adminu u kartičky."],
    ["", ""],
    [
      "Když je někde chyba",
      "nenahraje se NIC — vypíše se, na kterém řádku a co s tím. Nikdy se neuloží jen půlka.",
    ],
    ["Číslo čtyřlístku", "je klíč. Řádky se párují podle něj, ne podle pořadí — přeházet je můžete."],
  ];

  lines.forEach(([term, explain], i) => {
    const row = ws.getRow(first + i);
    row.getCell(1).value = term;
    row.getCell(3).value = explain;
    if (term && !explain) {
      row.getCell(1).font = { bold: true, size: 12 };
    } else if (term) {
      row.getCell(1).font = { bold: true, size: 10 };
      row.getCell(3).font = { size: 10 };
      row.getCell(3).alignment = { wrapText: true, vertical: "top" };
    }
    // Column B — the find number — is left EMPTY on every legend row, and
    // nothing here is merged across it. That is what lets the importer
    // walk past the legend: a row without a find number is not data. A
    // merged A:B cell would report its text in B and the legend would
    // come back as a hundred "«GPS» není číslo čtyřlístku" errors.
    if (term && explain) ws.mergeCells(first + i, 3, first + i, 9);
  });
}

/**
 * Locks the parts of the sheet nobody should be typing into.
 *
 * Protects the two header rows and the two read-only columns; everything
 * a person is meant to fill in stays open. The aim is the ACCIDENT — a
 * stray paste that wipes the header, a dragged fill handle that eats the
 * find numbers — not a determined editor.
 *
 * Note for whoever reads this after uploading to Google: the conversion
 * carries this over only partly, which is why the admin's instructions
 * ask for one manual "Chránit list → Zobrazit upozornění" pass. Doing it
 * here as well means the file is also safe when edited in Excel, and
 * costs nothing.
 */
async function lockStructure(
  ws: ExcelJS.Worksheet,
  rowCount: number,
): Promise<void> {
  const lastDataRow = HEADER_ROW + rowCount;
  const readOnlyCols = new Set(
    [...READ_ONLY].map((k) => COLUMNS.findIndex((c) => c.key === k) + 1),
  );

  // Everything is locked once the sheet is protected, so open up the
  // cells people are supposed to edit rather than locking the rest.
  for (let r = HEADER_ROW + 1; r <= lastDataRow; r++) {
    for (let c = 1; c <= COLUMNS.length; c++) {
      if (readOnlyCols.has(c)) continue;
      ws.getCell(r, c).protection = { locked: false };
    }
  }

  await ws.protect("", {
    // Selecting and sorting stay allowed — the sheet is for reading and
    // rearranging as much as for typing.
    selectLockedCells: true,
    selectUnlockedCells: true,
    formatCells: true,
    formatColumns: true,
    formatRows: true,
    sort: true,
    autoFilter: true,
    insertRows: false,
    deleteRows: false,
    insertColumns: false,
    deleteColumns: false,
  });
}

/** Spreadsheet column letter for a key, derived from COLUMNS rather than
 *  written down — inserting a column used to silently move a dropdown
 *  onto the wrong field. */
function columnLetter(key: string): string {
  const idx = COLUMNS.findIndex((c) => c.key === key);
  if (idx < 0) throw new Error(`Neznámý sloupec ${key}`);
  let n = idx + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export interface DropXlsxRow {
  /** 1-based position in the wave, by find number. Read-only. */
  ordinal: number;
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
  qrCaption: string;
  /** Empty string = inherits the campaign's size. */
  sizeCm: string;
  hintCs: string;
  hintEn: string;
  hintPublished: boolean;
  landingUrl: string;
  /** The crew's note about this card — usually where it goes. */
  note: string;
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
  ws.views = [{ state: "frozen", ySplit: HEADER_ROW }];

  // Coordinates as TEXT. Left to itself a Czech-locale Google Sheet reads
  // "49.2245, 17.6712" as something to reformat, and the pair comes back
  // as a number or a date — the one column where that is unrecoverable.
  ws.getColumn(columnLetter("gps")).numFmt = "@";

  for (const r of rows) {
    ws.addRow({
      ordinal: r.ordinal,
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
      qrCaption: r.qrCaption,
      sizeCm: r.sizeCm,
      hintCs: r.hintCs,
      hintEn: r.hintEn,
      hintPublished: r.hintPublished ? "ano" : "ne",
      landingUrl: r.landingUrl,
      note: r.note,
    });
  }

  paintGroups(ws, rows.length);
  appendLegend(ws, rows.length);
  await lockStructure(ws, rows.length);

  // Dropdowns on the columns with a closed vocabulary, so the sheet
  // teaches its own valid values instead of relying on the operator
  // remembering them.
  const last = Math.max(HEADER_ROW + 1, rows.length + HEADER_ROW);
  const statusList = `"${DROP_STATUS_ORDER.map((s) => DROP_STATUS_LABEL[s]).join(",")}"`;
  const validate = (key: string, formula: string, allowBlank: boolean) => {
    const col = columnLetter(key);
    for (let i = HEADER_ROW + 1; i <= last; i++) {
      ws.getCell(`${col}${i}`).dataValidation = {
        type: "list",
        allowBlank,
        formulae: [formula],
      };
    }
  };
  validate("status", statusList, false);
  validate("hintPublished", '"ano,ne"', false);
  if (placers.length > 0 && placers.join(",").length < 250) {
    validate("placedBy", `"${placers.join(",")}"`, true);
  }
  if (areaNames.length > 0 && areaNames.join(",").length < 250) {
    validate("area", `"${areaNames.join(",")}"`, true);
  }

  // A second sheet as the manual — the operator opening this in six
  // months shouldn't have to guess what an empty cell does.
  const help = wb.addWorksheet("Návod");
  help.columns = [{ width: 110 }];
  for (const line of [
    `Sada: ${campaignName}`,
    "",
    "Tenhle soubor slouží týmu k domluvě. Klidně ho dejte na sdílený disk a vyplňujte společně;",
    "hotovou verzi pak někdo nahraje v /admin/qr → Darování ve světě → Tabulka (xlsx).",
    "",
    "JAK SE ČTE",
    "• Barevné pruhy nad hlavičkou říkají, kam který text patří:",
    "    – Text na stránce po naskenování = co uvidí na mobilu ten, kdo kartičku najde.",
    "    – Text na kartičce s QR = co se fyzicky vytiskne nad a pod kódem.",
    "    – Nápověda k hledání = věta na stránce nálezu ve sbírce, když ji zveřejníte.",
    "• Buňky jsou předvyplněné tím, co kartička říká teď. Přepsat = udělat výjimku pro ten kus.",
    "• Když necháte hodnotu shodnou se sadou, kus dál sleduje sadu — pozdější změna sady se do něj propíše.",
    "• Prázdná buňka u textu = převzít ze sady.",
    "",
    "PRAVIDLA IMPORTU",
    "• Řádky se párují podle „Číslo čtyřlístku“. Číslo, které v sadě není, se přeskočí a nahlásí.",
    "• „Pořadí v sadě“ a „Odkaz“ se při importu ignorují; poznámka týmu se naopak načte.",
    "• GPS bere desetinné stupně (49.2245, 17.6712), DMS i odkaz z Mapy.cz nebo Google Maps.",
    "• Prázdná GPS pozici smaže.",
    `• Velikost tisku je šířka kartičky v cm (${DROP_SIZE_MIN_CM}–${DROP_SIZE_MAX_CM}).`,
    "• Chyba v jediném řádku zastaví celý soubor a vypíše se i s číslem řádku — nic se neuloží napůl.",
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
    qrCaption: string;
    sizeCm: number | null;
    hintCs: string;
    hintEn: string;
    hintPublished: boolean;
    note: string;
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

/**
 * Header spellings we still accept.
 *
 * A wave takes weeks and the sheet lives on somebody's shared drive, so a
 * copy made before a rename is a normal thing to receive — refusing it
 * would throw away real work over a caption.
 */
const HEADER_ALIASES: Record<string, string> = {
  "číslo nálezu": "findId",
  "titulek qr": "qrTitle",
  "titulek nad qr": "qrTitle",
  "text pod qr": "qrCaption",
};

function readHeaderRow(
  ws: ExcelJS.Worksheet,
  rowIndex: number,
): Map<string, number> {
  const out = new Map<string, number>();
  ws.getRow(rowIndex).eachCell((cell, col) => {
    const text = cellText(cell.value).trim().toLowerCase();
    if (!text) return;
    const key =
      COLUMNS.find((c) => c.header.toLowerCase() === text)?.key ??
      HEADER_ALIASES[text];
    if (key && !READ_ONLY.has(key)) out.set(key, col);
  });
  return out;
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
  //
  // The header row is found rather than assumed: the sheet grew a band of
  // group labels above it, and a copy of an older export (or one somebody
  // pasted into a fresh Google Sheet) still has its headers on row 1.
  let colByKey = new Map<string, number>();
  let headerRowIndex = HEADER_ROW;
  for (const candidate of [HEADER_ROW, 1, 3]) {
    const found = readHeaderRow(ws, candidate);
    if (found.has("findId")) {
      colByKey = found;
      headerRowIndex = candidate;
      break;
    }
  }

  const errors: string[] = [];
  if (!colByKey.has("findId")) {
    return {
      rows: [],
      errors: ['Chybí sloupec „Číslo čtyřlístku“ — bez něj se řádky nespárují.'],
    };
  }

  const rows: ParsedDropRow[] = [];
  const seen = new Set<number>();

  for (let r = headerRowIndex + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    // The explanation block lives under the data; everything from its
    // heading down is prose, not rows.
    if (cellText(row.getCell(1).value).trim() === LEGEND_SENTINEL) break;
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
      "qrCaption",
      "hintCs",
      "hintEn",
      "note",
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

    const rawSize = text("sizeCm");
    if (rawSize !== undefined) {
      if (rawSize === "") {
        values.sizeCm = null; // clears the override → inherits the campaign
      } else {
        // Somebody will type "4 cm". Strip the unit by hand — the obvious
        // /\s*cm$/i backtracks badly enough that the linter flags it.
        const cleaned = rawSize.replace(",", ".").trim();
        const bare = cleaned.toLowerCase().endsWith("cm")
          ? cleaned.slice(0, -2).trim()
          : cleaned;
        const n = Number(bare);
        if (!Number.isFinite(n) || n <= 0) {
          errors.push(`Řádek ${r}: „${rawSize}“ není velikost v cm.`);
        } else if (n < DROP_SIZE_MIN_CM || n > DROP_SIZE_MAX_CM) {
          errors.push(
            `Řádek ${r}: velikost ${rawSize} cm je mimo ${DROP_SIZE_MIN_CM}–${DROP_SIZE_MAX_CM} cm.`,
          );
        } else {
          values.sizeCm = n;
        }
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
