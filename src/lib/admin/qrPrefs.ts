import { promises as fs } from "node:fs";
import path from "node:path";
import { atomicWrite, ensureDir } from "./atomic";
import { ADMIN_ROOTS } from "./paths";

/**
 * Operator preferences for the QR admin page.
 *
 * Currently just the screen calibration: CSS pretends 1 cm is 37.8 px,
 * but a real monitor is anywhere from ~80 to ~220 physical pixels per
 * inch, so a "1 cm" box on screen can be 20 % off. The QR page lets the
 * operator size a rectangle against a payment card (85.6 mm by ISO/IEC
 * 7810 ID-1) once; the resulting px-per-cm makes the print preview
 * physically honest, which is the whole point of previewing a QR whose
 * scannability depends on millimetre-scale module size.
 *
 * Stored server-side in `data/.admin/` rather than localStorage: the
 * project bans client storage for app state, and this way the
 * calibration survives a cleared browser.
 */

const ADMIN_DIR = path.join(ADMIN_ROOTS.meta, "..", ".admin");
const PREFS_FILE = path.join(ADMIN_DIR, "qr-prefs.json");

/** CSS's nominal 96 dpi → 37.795 px/cm. Used until calibrated. */
export const DEFAULT_PX_PER_CM = 37.8;

/** Guard rails: below ~15 px/cm or above ~120 px/cm the operator has
 *  mis-dragged the slider rather than owning an exotic display. */
const MIN_PX_PER_CM = 15;
const MAX_PX_PER_CM = 120;

export interface QrPrefs {
  /** CSS pixels per physical centimetre on the operator's screen. */
  pxPerCm: number;
  /** True once the operator has actually calibrated (vs. the default). */
  calibrated: boolean;
}

export async function readQrPrefs(): Promise<QrPrefs> {
  let raw: string;
  try {
    raw = await fs.readFile(PREFS_FILE, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { pxPerCm: DEFAULT_PX_PER_CM, calibrated: false };
    }
    throw err;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    const px = (parsed as { pxPerCm?: unknown } | null)?.pxPerCm;
    if (typeof px === "number" && px >= MIN_PX_PER_CM && px <= MAX_PX_PER_CM) {
      return { pxPerCm: px, calibrated: true };
    }
  } catch {
    /* corrupt file → fall through to the default */
  }
  return { pxPerCm: DEFAULT_PX_PER_CM, calibrated: false };
}

/** Persists a calibration. Returns the clamped value actually stored. */
export async function writeQrPxPerCm(pxPerCm: number): Promise<number> {
  if (!Number.isFinite(pxPerCm)) {
    throw new Error("writeQrPxPerCm: pxPerCm must be a finite number");
  }
  const clamped = Math.min(MAX_PX_PER_CM, Math.max(MIN_PX_PER_CM, pxPerCm));
  await ensureDir(ADMIN_DIR);
  await atomicWrite(
    PREFS_FILE,
    JSON.stringify({ pxPerCm: Number(clamped.toFixed(3)) }, null, 2) + "\n",
  );
  return clamped;
}

/** Drops the calibration, returning the preview to CSS centimetres. */
export async function clearQrPxPerCm(): Promise<void> {
  try {
    await fs.unlink(PREFS_FILE);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
