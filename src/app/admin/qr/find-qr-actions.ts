"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/admin/session";
import { prisma } from "@/lib/db";
import { FindState } from "@/generated/prisma/client";
import { parseRanges } from "@/lib/parseRanges";
import { COLLECTION_TIME_ZONE } from "@/lib/collectionTime";
import {
  renderFindQrSvg,
  findQrUrl,
  moduleCountsFor,
  centerFitsDensity,
  type RenderFindQrOpts,
  type QrTheme,
  type QrModuleStyle,
  type QrCenter,
  type QrCenterScale,
  type QrBorder,
  type QrBorderRadius,
  type QrBorderColor,
  type QrDensity,
} from "@/lib/admin/qr";
import {
  writeQrPxPerCm,
  clearQrPxPerCm,
  writeFindQrFormPrefs,
  resetFindQrFormPrefs,
  readQrPrefs,
} from "@/lib/admin/qrPrefs";
import type { FindQrInput, FindQrRendered, FindQrTitleMode } from "./qr-types";

/**
 * Server actions behind the "QR kódy nálezů" section.
 *
 * There is deliberately no "create code" action: a find QR always encodes
 * `/n/<find id>`, so the code exists the moment the find does. These
 * actions only render images, and pin/unpin which finds show up in the
 * list beside the donated ones.
 */

/** Ceiling on ids handled by ONE render call. The form has no batch cap
 *  (the operator asked for none) — it chunks instead, so this bounds a
 *  single server action's response size, not the batch. */
const RENDER_CHUNK_MAX = 100;

type ActionResult<T> = (T & { ok: true }) | { ok: false; error: string };
type VoidResult = { ok: true } | { ok: false; error: string };

async function auth(): Promise<boolean> {
  try {
    await requireAuth();
    return true;
  } catch {
    return false;
  }
}

function pick<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

interface NormalizedFindQr {
  titleMode: FindQrTitleMode;
  theme: QrTheme;
  moduleStyle: QrModuleStyle;
  center: QrCenter;
  centerScale: QrCenterScale;
  border: QrBorder;
  borderRadius: QrBorderRadius;
  borderColor: QrBorderColor;
  density: QrDensity;
}

function normalize(input: FindQrInput): NormalizedFindQr {
  const density = pick(
    input.density,
    ["dense", "medium", "compact"] as const,
    "dense",
  );
  const centerScale = pick(input.centerScale, ["sm", "md"] as const, "md");
  let center = pick(
    input.center,
    ["clover", "smiley", "none"] as const,
    "smiley",
  );
  // Hard guard, not just a UI warning: a centre image punches a hole
  // through data modules and only spare error correction makes that
  // readable. Below the safe density the centre is dropped rather than
  // shipping a batch of cards that scan on the desk and fail in the wild.
  if (center !== "none" && !centerFitsDensity(density, centerScale)) {
    center = "none";
  }
  return {
    titleMode: pick(
      input.titleMode,
      ["id", "idDate", "idLocation", "none"] as const,
      "id",
    ),
    theme: pick(input.theme, ["brand", "classic", "dark"] as const, "brand"),
    moduleStyle: pick(
      input.moduleStyle,
      ["clover", "square", "dot"] as const,
      "clover",
    ),
    center,
    centerScale,
    border: pick(
      input.border,
      ["none", "frame", "panel", "cut"] as const,
      "none",
    ),
    borderRadius: pick(input.borderRadius, ["soft", "round"] as const, "soft"),
    borderColor: pick(input.borderColor, ["theme", "gray"] as const, "theme"),
    density,
  };
}

/**
 * Expands the operator's number spec into a sorted unique id list.
 * Accepts commas, whitespace and semicolons as separators, `-` for
 * ranges: "1, 5-9  12". Throws a Czech message on malformed input so the
 * form can show it verbatim.
 */
function expandSpec(spec: string): number[] {
  const parts = spec
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return [];
  try {
    return parseRanges(parts);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    const bad = /"([^"]*)"/.exec(msg)?.[1] ?? "";
    if (msg.includes("start > end")) {
      throw new Error(`Interval „${bad}“ má začátek větší než konec`);
    }
    throw new Error(`Neplatný zápis „${bad}“ — použij čísla, „5-9" a čárky`);
  }
}

/** Which of the requested ids actually exist, and their titles' data. */
async function loadFinds(ids: number[]) {
  return prisma.find.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      foundAt: true,
      location: { select: { code: true, displayName: true } },
    },
    orderBy: { id: "asc" },
  });
}

type FindRow = Awaited<ReturnType<typeof loadFinds>>[number];

/** Plain numeric date — the shared formatters all prefix a weekday,
 *  which is noise on a card that has to stay short. Always rendered in
 *  the collection's zone, never the process's (see lib/collectionTime). */
const CARD_DATE_FMT = new Intl.DateTimeFormat("cs-CZ", {
  day: "numeric",
  month: "numeric",
  year: "numeric",
  timeZone: COLLECTION_TIME_ZONE,
});

function titleFor(mode: FindQrTitleMode, f: FindRow): string | null {
  if (mode === "none") return null;
  const base = `🍀 #${f.id}`;
  if (mode === "idDate") {
    return f.foundAt ? `${base} · ${CARD_DATE_FMT.format(f.foundAt)}` : base;
  }
  if (mode === "idLocation") {
    const name = f.location?.displayName?.trim();
    return name ? `${base} · ${name}` : base;
  }
  return base;
}

/** Every option the form collects, funnelled into the renderer. */
function renderOptsFor(n: NormalizedFindQr, f: FindRow): RenderFindQrOpts {
  return {
    header: titleFor(n.titleMode, f),
    density: n.density,
    theme: n.theme,
    moduleStyle: n.moduleStyle,
    center: n.center,
    centerScale: n.centerScale,
    border: n.border,
    borderRadius: n.borderRadius,
    borderColor: n.borderColor,
  };
}

/**
 * Resolves a number spec against the DB without rendering anything —
 * the form calls this on every edit to show "N nálezů, M neexistuje"
 * before the operator commits to a download.
 */
export async function resolveFindIdsAction(
  spec: string,
): Promise<ActionResult<{ found: number[]; missing: number[] }>> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  let ids: number[];
  try {
    ids = expandSpec(String(spec ?? ""));
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Chybný zápis",
    };
  }
  if (ids.length === 0) return { ok: true, found: [], missing: [] };
  try {
    const rows = await prisma.find.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    const have = new Set(rows.map((r) => r.id));
    return {
      ok: true,
      found: ids.filter((i) => have.has(i)),
      missing: ids.filter((i) => !have.has(i)),
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Načtení nálezů selhalo",
    };
  }
}

/** Renders one chunk of find QR codes. The client walks the batch in
 *  RENDER_CHUNK_MAX-sized slices so a huge batch streams in with
 *  progress instead of arriving as one enormous payload. */
export async function renderFindQrChunkAction(
  ids: number[],
  input: FindQrInput,
): Promise<ActionResult<{ items: FindQrRendered[] }>> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  const clean = (Array.isArray(ids) ? ids : [])
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, RENDER_CHUNK_MAX);
  if (clean.length === 0) return { ok: true, items: [] };
  try {
    const n = normalize(input);
    const rows = await loadFinds(clean);
    const items = rows.map((f) => ({
      findId: f.id,
      svg: renderFindQrSvg(f.id, renderOptsFor(n, f)),
    }));
    return { ok: true, items };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Generování selhalo",
    };
  }
}

/** Single-code live preview. Uses a real find when the spec resolves to
 *  one, otherwise a representative id so the module count is honest. */
export async function previewFindQrAction(
  findId: number | null,
  input: FindQrInput,
): Promise<
  ActionResult<{
    svg: string;
    findId: number;
    /** Module count per side at each density, for THIS find's URL. */
    moduleCounts: Record<string, number>;
  }>
> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  try {
    const n = normalize(input);
    const id =
      Number.isInteger(findId) && (findId as number) > 0
        ? (findId as number)
        : 12345;
    const rows = await loadFinds([id]);
    const row: FindRow = rows[0] ?? { id, foundAt: null, location: null };
    return {
      ok: true,
      findId: id,
      moduleCounts: moduleCountsFor(findQrUrl(id)),
      svg: renderFindQrSvg(id, renderOptsFor(n, row)),
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Náhled selhal",
    };
  }
}

/** Pins finds into the list (so non-donated ones stay visible). Donated
 *  finds need no pin — the list derives those from find state. */
export async function pinFindQrAction(
  spec: string,
): Promise<ActionResult<{ pinned: number; missing: number[] }>> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  let ids: number[];
  try {
    ids = expandSpec(String(spec ?? ""));
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Chybný zápis",
    };
  }
  if (ids.length === 0) return { ok: false, error: "Zadej číslo nálezu" };
  try {
    const rows = await prisma.find.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    const have = rows.map((r) => r.id);
    const haveSet = new Set(have);
    if (have.length > 0) {
      await prisma.findQrPin.createMany({
        data: have.map((findId) => ({ findId })),
        skipDuplicates: true,
      });
    }
    revalidatePath("/admin/qr");
    return {
      ok: true,
      pinned: have.length,
      missing: ids.filter((i) => !haveSet.has(i)),
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Připnutí selhalo",
    };
  }
}

/** Removes a pin. Donated finds stay in the list regardless — the pin is
 *  only what keeps a NON-donated find visible. */
export async function unpinFindQrAction(findId: number): Promise<VoidResult> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  if (!Number.isInteger(findId) || findId <= 0) {
    return { ok: false, error: "Neplatné ID nálezu" };
  }
  try {
    await prisma.findQrPin.deleteMany({ where: { findId } });
    revalidatePath("/admin/qr");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Odepnutí selhalo",
    };
  }
}

/** Stores the screen calibration (CSS px per physical centimetre). */
export async function saveQrCalibrationAction(
  pxPerCm: number,
): Promise<ActionResult<{ pxPerCm: number }>> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  try {
    const stored = await writeQrPxPerCm(Number(pxPerCm));
    revalidatePath("/admin/qr");
    return { ok: true, pxPerCm: stored };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Uložení kalibrace selhalo",
    };
  }
}

export async function resetQrCalibrationAction(): Promise<VoidResult> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  try {
    await clearQrPxPerCm();
    revalidatePath("/admin/qr");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Reset kalibrace selhal",
    };
  }
}

/** Remembers the form setup for next time. Fire-and-forget from the
 *  client — a failed save is a lost convenience, never a lost batch, so
 *  it deliberately doesn't surface an error in the UI. */
export async function saveFindQrFormPrefsAction(
  sizeCm: number,
  form: FindQrInput,
): Promise<VoidResult> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  try {
    await writeFindQrFormPrefs(sizeCm, form);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Uložení nastavení selhalo",
    };
  }
}

/** Back to the shipped defaults (keeps the screen calibration). Returns
 *  them so the client can apply them without a second round-trip and
 *  without duplicating the values — qrPrefs.ts is server-only. */
export async function resetFindQrFormPrefsAction(): Promise<
  ActionResult<{ sizeCm: number; form: FindQrInput }>
> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  try {
    await resetFindQrFormPrefs();
    revalidatePath("/admin/qr");
    const prefs = await readQrPrefs();
    return { ok: true, sizeCm: prefs.sizeCm, form: prefs.form as FindQrInput };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Reset nastavení selhal",
    };
  }
}

/** Ids of all donated finds — the "Darované" default view, and the
 *  one-click "vyplnit všechny darované" button in the form. */
export async function donatedFindIdsAction(): Promise<
  ActionResult<{ ids: number[] }>
> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  try {
    const rows = await prisma.findStateAssignment.findMany({
      where: { state: FindState.DONATED },
      select: { findId: true },
      orderBy: { findId: "asc" },
    });
    return { ok: true, ids: rows.map((r) => r.findId) };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Načtení darovaných selhalo",
    };
  }
}
