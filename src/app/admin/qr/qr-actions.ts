"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/admin/session";
import { prisma } from "@/lib/db";
import {
  renderQrSvg,
  type QrTheme,
  type QrModuleStyle,
  type QrCenter,
  type QrCenterScale,
  type QrSize,
  type RenderQrOpts,
} from "@/lib/admin/qr";
import {
  QR_TARGET_KEYS,
  qrTargetUrl,
} from "@/lib/admin/qrTargets";
import { siteName } from "@/lib/siteName";
import type { QrInput } from "./qr-types";

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://ctyrlistkoteka.cz"
).replace(/\/$/, "");

// Unambiguous alphabet (no 0/O/1/l/I) — tokens occasionally get read by
// a human off the URL, and we never want a typo'd collision.
const TOKEN_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

// QrInput (the raw option bag from the client) lives in ./qr-types — a
// "use server" module may only export async functions. Everything is
// coerced to a known-good value in `normalize` so a tampered payload
// can't reach the renderer or the DB.

interface NormalizedQr {
  label: string;
  target: string;
  locale: "cs" | "en";
  theme: QrTheme;
  moduleStyle: QrModuleStyle;
  center: QrCenter;
  centerScale: QrCenterScale;
  showTitle: boolean;
  titleText: string;
  showCaption: boolean;
  size: QrSize;
}

function pick<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function normalize(input: QrInput): NormalizedQr {
  return {
    label: String(input.label ?? "").trim().slice(0, 200),
    target: pick(input.target, QR_TARGET_KEYS as readonly string[], "home"),
    locale: pick(input.locale, ["cs", "en"] as const, "cs"),
    theme: pick(input.theme, ["brand", "classic", "dark"] as const, "brand"),
    moduleStyle: pick(
      input.moduleStyle,
      ["clover", "square", "dot"] as const,
      "clover",
    ),
    center: pick(input.center, ["clover", "smiley", "none"] as const, "clover"),
    centerScale: pick(input.centerScale, ["sm", "md"] as const, "md"),
    showTitle: input.showTitle !== false,
    titleText: String(input.titleText ?? "").trim().slice(0, 200),
    showCaption: input.showCaption === true,
    size: pick(input.size, ["sm", "md", "lg"] as const, "md"),
  };
}

/** Build renderQrSvg args from a normalized config + the URL to encode.
 *  Title defaults to the (locale-aware) site name; caption to the
 *  human-readable destination URL. */
function renderOptsFor(n: NormalizedQr, url: string): RenderQrOpts {
  const friendly = qrTargetUrl(n.target, n.locale, SITE_URL).replace(
    /^https?:\/\//,
    "",
  );
  return {
    url,
    title: n.showTitle ? n.titleText || siteName(n.locale) : null,
    caption: n.showCaption ? friendly : null,
    theme: n.theme,
    moduleStyle: n.moduleStyle,
    center: n.center,
    centerScale: n.centerScale,
    size: n.size,
  };
}

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { code?: string }).code === "P2002"
  );
}

function genToken(len = 8): string {
  const bytes = randomBytes(len);
  let s = "";
  for (let i = 0; i < len; i++) {
    s += TOKEN_ALPHABET[bytes[i]! % TOKEN_ALPHABET.length];
  }
  return s;
}

type ActionResult<T> = (T & { ok: true }) | { ok: false; error: string };

async function auth(): Promise<boolean> {
  try {
    await requireAuth();
    return true;
  } catch {
    return false;
  }
}

/** Live preview — renders against the direct destination URL (no token
 *  is created yet). The created QR encodes the same-length /go/<token>,
 *  so the preview is visually representative. */
export async function previewQrAction(
  input: QrInput,
): Promise<ActionResult<{ svg: string }>> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  try {
    const n = normalize(input);
    const url = `${qrTargetUrl(n.target, n.locale, SITE_URL)}?ref=qr`;
    return { ok: true, svg: renderQrSvg(renderOptsFor(n, url)) };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Náhled selhal",
    };
  }
}

/** Persist a QR (mints a token) and return the trackable SVG. */
export async function createQrAction(
  input: QrInput,
): Promise<ActionResult<{ id: number; token: string; svg: string }>> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  const n = normalize(input);
  if (!n.label) return { ok: false, error: "Vyplň název QR kódu" };
  try {
    let created: { id: number; token: string } | null = null;
    for (let i = 0; i < 5 && !created; i++) {
      const token = genToken(8);
      try {
        const row = await prisma.qrCode.create({
          data: {
            token,
            label: n.label,
            target: n.target,
            locale: n.locale,
            theme: n.theme,
            moduleStyle: n.moduleStyle,
            centerImage: n.center,
            centerScale: n.centerScale,
            showTitle: n.showTitle,
            titleText: n.titleText || null,
            showCaption: n.showCaption,
            size: n.size,
          },
          select: { id: true, token: true },
        });
        created = row;
      } catch (e) {
        if (!isUniqueViolation(e) || i === 4) throw e;
      }
    }
    if (!created) return { ok: false, error: "Nepodařilo se vytvořit token" };
    const url = `${SITE_URL}/go/${created.token}`;
    const svg = renderQrSvg(renderOptsFor(n, url));
    revalidatePath("/admin/qr");
    return { ok: true, id: created.id, token: created.token, svg };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Vytvoření selhalo",
    };
  }
}

/** Re-render a stored QR (for re-download from the evidence list). */
export async function getQrSvgAction(
  id: number,
): Promise<ActionResult<{ svg: string; token: string; label: string }>> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  try {
    const row = await prisma.qrCode.findUnique({ where: { id } });
    if (!row) return { ok: false, error: "QR kód nenalezen" };
    const n: NormalizedQr = {
      label: row.label,
      target: row.target,
      locale: row.locale === "en" ? "en" : "cs",
      theme: pick(row.theme, ["brand", "classic", "dark"] as const, "brand"),
      moduleStyle: pick(
        row.moduleStyle,
        ["clover", "square", "dot"] as const,
        "clover",
      ),
      center: pick(
        row.centerImage,
        ["clover", "smiley", "none"] as const,
        "clover",
      ),
      centerScale: pick(row.centerScale, ["sm", "md"] as const, "md"),
      showTitle: row.showTitle,
      titleText: row.titleText ?? "",
      showCaption: row.showCaption,
      size: pick(row.size, ["sm", "md", "lg"] as const, "md"),
    };
    const url = `${SITE_URL}/go/${row.token}`;
    return {
      ok: true,
      svg: renderQrSvg(renderOptsFor(n, url)),
      token: row.token,
      label: row.label,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Načtení selhalo",
    };
  }
}

async function setArchived(
  id: number,
  archived: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await auth())) return { ok: false, error: "Neautentizováno" };
  try {
    await prisma.qrCode.update({
      where: { id },
      data: { archivedAt: archived ? new Date() : null },
    });
    revalidatePath("/admin/qr");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Akce selhala",
    };
  }
}

export async function archiveQrAction(id: number) {
  return setArchived(id, true);
}

export async function restoreQrAction(id: number) {
  return setArchived(id, false);
}
