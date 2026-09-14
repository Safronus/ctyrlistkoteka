"use server";

import { revalidatePath } from "next/cache";
import { requireAuth, getRequestIp } from "@/lib/admin/session";
import { prisma } from "@/lib/db";
import {
  CASQB_DEFAULT_STYLE,
  casqbStyleProblems,
  parseCasqbStyle,
  renderCasqbQrSvg,
  type CasqbStyle,
} from "@/lib/admin/casqbQr";
import { parseCasqbTargetUrl } from "@/lib/admin/casqbTarget";
import { genQrToken } from "@/lib/admin/qrToken";
import { appendAudit } from "@/lib/admin/audit";

import type { CasqbInput } from "./casqb-types";

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://ctyrlistkoteka.cz"
).replace(/\/$/, "");

/** Six characters (57⁶ ≈ 3·10¹⁰): one QR version smaller than the page
 *  codes' eight, which matters on a business card. */
const TOKEN_LENGTH = 6;
/** What the live preview encodes before a token exists — the same
 *  length, so the preview has the same module count as the real code. */
const PREVIEW_TOKEN = "xxxxxx";

/** Rendered width of the downloadable SVG; the vector scales anyway. */
const SVG_PX = 1024;

type ActionResult<T> = (T & { ok: true }) | { ok: false; error: string };

async function auth(): Promise<boolean> {
  try {
    await requireAuth();
    return true;
  } catch {
    return false;
  }
}

interface NormalizedCasqb {
  label: string;
  targetUrl: string;
  style: CasqbStyle;
}

/** Everything the client sent, coerced or refused. The style goes
 *  through the schema and then the readability rules — a code that
 *  cannot be scanned is refused here, not discovered at the printer. */
function normalizeCasqb(
  input: CasqbInput,
): { ok: true; value: NormalizedCasqb } | { ok: false; error: string } {
  const label = String(input.label ?? "")
    .trim()
    .slice(0, 200);
  if (!label) return { ok: false, error: "Vyplň popisek kódu." };
  const target = parseCasqbTargetUrl(input.targetUrl);
  if (!target.ok) return target;
  const style = parseCasqbStyle({ ...CASQB_DEFAULT_STYLE, ...(input.style ?? {}) });
  if (!style) return { ok: false, error: "Styl kódu je neplatný." };
  const problems = casqbStyleProblems(style);
  if (problems.length > 0) return { ok: false, error: problems.join(" ") };
  return { ok: true, value: { label, targetUrl: target.url, style } };
}

function svgFor(style: CasqbStyle, token: string): string {
  return renderCasqbQrSvg({
    url: `${SITE_URL}/go/${token}`,
    style,
    px: SVG_PX,
  });
}

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { code?: string }).code === "P2002"
  );
}

/** Live preview. The style is validated but a missing label or URL is
 *  fine here — the preview should follow the picker, not wait for the
 *  form to be complete. */
export async function previewCasqbAction(
  style: unknown,
): Promise<ActionResult<{ svg: string; problems: string[] }>> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  const parsed = parseCasqbStyle({
    ...CASQB_DEFAULT_STYLE,
    ...((style ?? {}) as object),
  });
  if (!parsed) return { ok: false, error: "Styl kódu je neplatný." };
  return {
    ok: true,
    svg: svgFor(parsed, PREVIEW_TOKEN),
    problems: casqbStyleProblems(parsed),
  };
}

export async function createCasqbAction(
  input: CasqbInput,
): Promise<ActionResult<{ id: number; token: string; svg: string }>> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  const n = normalizeCasqb(input);
  if (!n.ok) return n;
  try {
    let created: { id: number; token: string } | null = null;
    for (let i = 0; i < 5 && !created; i++) {
      const token = genQrToken(TOKEN_LENGTH);
      try {
        created = await prisma.qrCode.create({
          data: {
            token,
            kind: "casqb",
            label: n.value.label,
            target: "home",
            targetUrl: n.value.targetUrl,
            style: n.value.style,
          },
          select: { id: true, token: true },
        });
      } catch (e) {
        if (!isUniqueViolation(e) || i === 4) throw e;
      }
    }
    if (!created) return { ok: false, error: "Nepodařilo se vytvořit token." };
    await appendAudit({
      action: "casqb.create",
      ip: await getRequestIp(),
      details: { id: created.id, label: n.value.label },
    });
    revalidatePath("/admin/qr");
    return {
      ok: true,
      id: created.id,
      token: created.token,
      svg: svgFor(n.value.style, created.token),
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Vytvoření selhalo",
    };
  }
}

/** Label, destination and look are all editable — the token, and so the
 *  printed code, never changes. */
export async function updateCasqbAction(
  id: number,
  input: CasqbInput,
): Promise<ActionResult<{ svg: string }>> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  const n = normalizeCasqb(input);
  if (!n.ok) return n;
  try {
    const row = await prisma.qrCode.update({
      where: { id, kind: "casqb" },
      data: {
        label: n.value.label,
        targetUrl: n.value.targetUrl,
        style: n.value.style,
      },
      select: { token: true },
    });
    await appendAudit({
      action: "casqb.update",
      ip: await getRequestIp(),
      details: { id, label: n.value.label },
    });
    revalidatePath("/admin/qr");
    revalidatePath(`/admin/qr/casqb/${id}`);
    return { ok: true, svg: svgFor(n.value.style, row.token) };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Uložení selhalo",
    };
  }
}

/** Re-render a stored code for download. */
export async function getCasqbSvgAction(
  id: number,
): Promise<ActionResult<{ svg: string; token: string; label: string; style: CasqbStyle; targetUrl: string }>> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  const row = await prisma.qrCode.findUnique({ where: { id } });
  if (!row || row.kind !== "casqb") return { ok: false, error: "Kód nenalezen." };
  const style = parseCasqbStyle(row.style) ?? CASQB_DEFAULT_STYLE;
  return {
    ok: true,
    svg: svgFor(style, row.token),
    token: row.token,
    label: row.label,
    style,
    targetUrl: row.targetUrl ?? "",
  };
}

async function setArchived(id: number, archived: boolean) {
  if (!(await auth())) return { ok: false as const, error: "Neautentizováno" };
  try {
    await prisma.qrCode.update({
      where: { id, kind: "casqb" },
      data: { archivedAt: archived ? new Date() : null },
    });
    await appendAudit({
      action: archived ? "casqb.retire" : "casqb.restore",
      ip: await getRequestIp(),
      details: { id },
    });
    revalidatePath("/admin/qr");
    revalidatePath(`/admin/qr/casqb/${id}`);
    return { ok: true as const };
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : "Akce selhala",
    };
  }
}

/** "Vyřadit": out of the active list, but the redirect keeps working —
 *  a card on someone's desk must not go dead. Scans after this moment
 *  are counted separately. */
export async function retireCasqbAction(id: number) {
  return setArchived(id, true);
}

export async function restoreCasqbAction(id: number) {
  return setArchived(id, false);
}

/** Wipes the scan log of one code. The history is gone for good, which
 *  is the point (a test run before the real print); the UI confirms. */
export async function resetCasqbScansAction(
  id: number,
): Promise<ActionResult<{ removed: number }>> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  try {
    const code = await prisma.qrCode.findUnique({
      where: { id },
      select: { kind: true },
    });
    if (!code || code.kind !== "casqb") return { ok: false, error: "Kód nenalezen." };
    const r = await prisma.qrScan.deleteMany({ where: { qrCodeId: id } });
    await appendAudit({
      action: "casqb.scans_reset",
      ip: await getRequestIp(),
      details: { id, removed: r.count },
    });
    revalidatePath("/admin/qr");
    revalidatePath(`/admin/qr/casqb/${id}`);
    return { ok: true, removed: r.count };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Vynulování selhalo",
    };
  }
}

/** Deletes the code and its scans. Unlike retiring, the token stops
 *  resolving — only for codes that were never printed. */
export async function deleteCasqbAction(id: number): Promise<ActionResult<object>> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  try {
    await prisma.qrCode.delete({ where: { id, kind: "casqb" } });
    await appendAudit({
      action: "casqb.delete",
      ip: await getRequestIp(),
      details: { id },
    });
    revalidatePath("/admin/qr");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Smazání selhalo",
    };
  }
}

/** Accepted upload size — a logo is a small vector or a small bitmap;
 *  anything bigger is a photo by mistake. */
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
/** Longest side of the stored bitmap. Enough for a 20 cm print at
 *  300 DPI of a logo that is a quarter of the code. */
const LOGO_MAX_PX = 1024;

/**
 * Turns an uploaded SVG or PNG into the PNG the style stores.
 *
 * Always a bitmap, even for an SVG: the logo ends up inside an SVG the
 * owner downloads and opens anywhere, and a raster is the one form of
 * "someone else's file" that can carry nothing executable. sharp
 * (librsvg) does the rendering and ignores scripts by construction.
 */
export async function uploadCasqbLogoAction(
  form: FormData,
): Promise<ActionResult<{ data: string; width: number; height: number }>> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  const file = form.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Chybí soubor." };
  if (file.size > LOGO_MAX_BYTES) {
    return { ok: false, error: "Soubor je větší než 2 MB." };
  }
  const isSvg = file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
  const isPng = file.type === "image/png" || /\.png$/i.test(file.name);
  if (!isSvg && !isPng) return { ok: false, error: "Nahraj SVG nebo PNG." };
  try {
    const sharp = (await import("sharp")).default;
    const input = Buffer.from(await file.arrayBuffer());
    const out = await sharp(input, { density: 300 })
      .resize({ width: LOGO_MAX_PX, height: LOGO_MAX_PX, fit: "inside", withoutEnlargement: !isSvg })
      .png({ compressionLevel: 9 })
      .toBuffer({ resolveWithObject: true });
    const data = out.data.toString("base64");
    if (data.length > 280_000) {
      return { ok: false, error: "Obrázek je i po zmenšení příliš velký — zkus jednodušší logo." };
    }
    return { ok: true, data, width: out.info.width, height: out.info.height };
  } catch {
    return { ok: false, error: "Obrázek se nepodařilo přečíst." };
  }
}
