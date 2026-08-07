import { promises as fs } from "node:fs";
import path from "node:path";
import { atomicWrite, ensureDir } from "./atomic";
import { ADMIN_ROOTS } from "./paths";

/**
 * Operator preferences for the QR admin page: the screen calibration and
 * the last-used find-QR form setup.
 *
 * The calibration exists because CSS pretends 1 cm is 37.8 px while a
 * real monitor is anywhere from ~80 to ~220 physical pixels per inch —
 * so a "1 cm" box on screen can be 20 % off. The operator sizes a
 * rectangle against a payment card (85.6 mm by ISO/IEC 7810 ID-1) once;
 * the resulting px-per-cm makes the print preview physically honest,
 * which is the whole point of previewing a QR whose scannability depends
 * on millimetre-scale module size.
 *
 * Stored server-side in `data/.admin/` rather than localStorage: the
 * project bans client storage for app state, and this way both the
 * calibration and the form setup survive a cleared browser.
 *
 * Everything here is best-effort convenience — a missing or corrupt file
 * falls back to defaults rather than failing, because losing it costs
 * nothing but re-picking two switches.
 */

const ADMIN_DIR = path.join(ADMIN_ROOTS.meta, "..", ".admin");
const PREFS_FILE = path.join(ADMIN_DIR, "qr-prefs.json");

/** CSS's nominal 96 dpi → 37.795 px/cm. Used until calibrated. */
export const DEFAULT_PX_PER_CM = 37.8;

/** Guard rails: below ~15 px/cm or above ~120 px/cm the operator has
 *  mis-dragged the slider rather than owning an exotic display. */
const MIN_PX_PER_CM = 15;
const MAX_PX_PER_CM = 120;

/** Printed width in cm the form opens at, and the range its slider spans. */
export const DEFAULT_SIZE_CM = 4;
const MIN_SIZE_CM = 1.5;
const MAX_SIZE_CM = 12;

/**
 * Defaults for the find-QR form.
 *
 * `medium` (error-correction Q) rather than `dense` (H): a find URL is
 * short enough that Q needs 29 modules where H needs 33, so Q prints
 * BIGGER, more scannable dots at the same physical size while still
 * carrying enough spare capacity for a small centre image — hence the
 * paired `centerScale: "sm"`, which is what `centerFitsDensity` allows
 * at that level.
 */
export const DEFAULT_FIND_QR_FORM = {
  titleMode: "id",
  theme: "brand",
  moduleStyle: "clover",
  center: "smiley",
  centerScale: "sm",
  border: "none",
  borderRadius: "soft",
  borderColor: "theme",
  density: "medium",
} as const;

export type FindQrFormPrefs = {
  -readonly [K in keyof typeof DEFAULT_FIND_QR_FORM]: string;
};

export interface QrPrefs {
  /** CSS pixels per physical centimetre on the operator's screen. */
  pxPerCm: number;
  /** True once the operator has actually calibrated (vs. the default). */
  calibrated: boolean;
  /** Last-used printed width, cm. */
  sizeCm: number;
  /** Last-used find-QR form setup. */
  form: FindQrFormPrefs;
}

/** Which values each form key may take. Anything else in the file is
 *  ignored in favour of the default — the file is hand-editable and a
 *  stale key must not reach the renderer. */
const FORM_ALLOWED: Record<keyof FindQrFormPrefs, readonly string[]> = {
  titleMode: ["id", "idDate", "idLocation", "none"],
  theme: ["brand", "classic", "dark"],
  moduleStyle: ["clover", "square", "dot"],
  center: ["clover", "smiley", "none"],
  centerScale: ["sm", "md"],
  border: ["none", "frame", "panel", "cut"],
  borderRadius: ["soft", "round"],
  borderColor: ["theme", "gray"],
  density: ["dense", "medium", "compact"],
};

function defaultForm(): FindQrFormPrefs {
  return { ...DEFAULT_FIND_QR_FORM };
}

function coerceForm(raw: unknown): FindQrFormPrefs {
  const out = defaultForm();
  if (!raw || typeof raw !== "object") return out;
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(out) as (keyof FindQrFormPrefs)[]) {
    const v = obj[key];
    if (typeof v === "string" && FORM_ALLOWED[key].includes(v)) out[key] = v;
  }
  return out;
}

export async function readQrPrefs(): Promise<QrPrefs> {
  const fallback: QrPrefs = {
    pxPerCm: DEFAULT_PX_PER_CM,
    calibrated: false,
    sizeCm: DEFAULT_SIZE_CM,
    form: defaultForm(),
  };

  let raw: string;
  try {
    raw = await fs.readFile(PREFS_FILE, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw err;
  }

  let parsed: Record<string, unknown>;
  try {
    const j = JSON.parse(raw) as unknown;
    if (!j || typeof j !== "object") return fallback;
    parsed = j as Record<string, unknown>;
  } catch {
    return fallback; // corrupt file → defaults, never a crash
  }

  const px = parsed.pxPerCm;
  const calibrated =
    typeof px === "number" && px >= MIN_PX_PER_CM && px <= MAX_PX_PER_CM;
  const size = parsed.sizeCm;

  return {
    pxPerCm: calibrated ? (px as number) : DEFAULT_PX_PER_CM,
    calibrated,
    sizeCm:
      typeof size === "number" && size >= MIN_SIZE_CM && size <= MAX_SIZE_CM
        ? size
        : DEFAULT_SIZE_CM,
    form: coerceForm(parsed.form),
  };
}

/** Read-modify-write of the prefs file. Every writer goes through this so
 *  saving a calibration can't wipe the form setup, or vice versa. */
async function patchPrefs(patch: Record<string, unknown>): Promise<void> {
  const current = await readQrPrefs();
  const next: Record<string, unknown> = {
    ...(current.calibrated ? { pxPerCm: current.pxPerCm } : {}),
    sizeCm: current.sizeCm,
    form: current.form,
    ...patch,
  };
  await ensureDir(ADMIN_DIR);
  await atomicWrite(PREFS_FILE, JSON.stringify(next, null, 2) + "\n");
}

/** Persists a calibration. Returns the clamped value actually stored. */
export async function writeQrPxPerCm(pxPerCm: number): Promise<number> {
  if (!Number.isFinite(pxPerCm)) {
    throw new Error("writeQrPxPerCm: pxPerCm must be a finite number");
  }
  const clamped = Math.min(MAX_PX_PER_CM, Math.max(MIN_PX_PER_CM, pxPerCm));
  await patchPrefs({ pxPerCm: Number(clamped.toFixed(3)) });
  return clamped;
}

/** Drops the calibration, returning the preview to CSS centimetres.
 *  Leaves the form setup alone — they're independent choices. */
export async function clearQrPxPerCm(): Promise<void> {
  await patchPrefs({ pxPerCm: undefined });
}

/** Remembers the find-QR form setup so the next batch starts where the
 *  last one left off. */
export async function writeFindQrFormPrefs(
  sizeCm: number,
  form: unknown,
): Promise<void> {
  const size = Number(sizeCm);
  await patchPrefs({
    sizeCm:
      Number.isFinite(size) && size >= MIN_SIZE_CM && size <= MAX_SIZE_CM
        ? Number(size.toFixed(1))
        : DEFAULT_SIZE_CM,
    form: coerceForm(form),
  });
}

/** Back to the shipped defaults, keeping the screen calibration (which
 *  is a property of the monitor, not of a print job). */
export async function resetFindQrFormPrefs(): Promise<void> {
  await patchPrefs({ sizeCm: DEFAULT_SIZE_CM, form: defaultForm() });
}
