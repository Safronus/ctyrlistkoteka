import { promises as fs } from "node:fs";
import path from "node:path";
import { atomicWrite, ensureDir } from "@/lib/admin/atomic";
import { ADMIN_ROOTS } from "@/lib/admin/paths";

/**
 * Admin-managed overrides for the explanatory banners shown ABOVE a find
 * photo (the per-state notices + the Czech-record badge). A display layer
 * on top of the baked-in `FindDetail` i18n messages: when an override is
 * present for a given banner + locale it wins, otherwise the site falls
 * back to the translation shipped in `messages/<locale>.json`.
 *
 * Stored in `data/.admin/` (like the find-note overrides): admin runtime
 * state that survives both the Mac→VPS rsync and a full DB re-sync, and is
 * read directly by the web (never imported into the DB by sync).
 *
 * File shape — keyed by the i18n message key:
 *   { "stateBannerNoPhoto": { "cs": "…", "en": "…" } }
 * Both variants are optional and independent: a missing variant just means
 * "use the i18n default for that locale". We only ever store a variant when
 * it differs from the current default, so tweaking a default in the message
 * catalogue still propagates to any banner the admin hasn't customised.
 */

export interface BannerTextOverride {
  cs?: string;
  en?: string;
}

/** The banners the admin may edit, in display order. `key` is the message
 *  key inside the `FindDetail` next-intl namespace; `label` / `hint` are
 *  Czech admin-UI copy describing when the banner shows. */
export const BANNER_TEXT_KEYS = [
  {
    key: "recordBadge",
    label: "Český rekord (odznak)",
    hint: "Zlatý pruh nad fotkou u nálezu s efektem rekord.",
  },
  {
    key: "lostBanner",
    label: "Ztracený nález (LOST)",
    hint: "Nález, který už fyzicky není — žije jen na fotce.",
  },
  {
    key: "anonymizedNotice",
    label: "Anonymizovaný nález (ANONYMIZED)",
    hint: "Skrytá poloha, poznámka i lokalita.",
  },
  {
    key: "stateBannerDonated",
    label: "Darovaný nález (DONATED)",
    hint: "Vylisovaný a darovaný — ve sbírce fyzicky není.",
  },
  {
    key: "stateBannerGigant",
    label: "Gigant (GIGANT)",
    hint: "Extrémně velký čtyřlístek.",
  },
  {
    key: "stateBannerNoGps",
    label: "Bez GPS (NO_GPS)",
    hint: "Fotka bez EXIF souřadnic.",
  },
  {
    key: "stateBannerNoPhoto",
    label: "Bez fotky (NO_PHOTO)",
    hint: "Fyzicky ve sbírce, ale bez fotky z místa nálezu.",
  },
] as const;

export type BannerTextKey = (typeof BANNER_TEXT_KEYS)[number]["key"];

const KEY_SET: ReadonlySet<string> = new Set(BANNER_TEXT_KEYS.map((k) => k.key));

/** Whether `k` is one of the editable banner keys (guards the writer). */
export function isBannerTextKey(k: unknown): k is BannerTextKey {
  return typeof k === "string" && KEY_SET.has(k);
}

const ADMIN_DIR = path.join(ADMIN_ROOTS.meta, "..", ".admin");
const FILE = path.join(ADMIN_DIR, "banner-texts.json");

function clean(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

/** Full store as a Map<bannerKey, override>. Empty on a missing/corrupt
 *  file; unknown keys are dropped so the file can't smuggle arbitrary
 *  message keys into the render path. */
export async function readBannerTextOverrides(): Promise<
  Map<string, BannerTextOverride>
> {
  let raw: string;
  try {
    raw = await fs.readFile(FILE, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw err;
  }
  const out = new Map<string, BannerTextOverride>();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return out;
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!isBannerTextKey(k) || !v || typeof v !== "object") continue;
      const cs = clean((v as Record<string, unknown>).cs);
      const en = clean((v as Record<string, unknown>).en);
      if (cs || en) {
        out.set(k, { ...(cs ? { cs } : {}), ...(en ? { en } : {}) });
      }
    }
  } catch {
    return new Map();
  }
  return out;
}

/** Upsert a banner's override (or delete it when both variants are blank).
 *  Admin / server-action only — the web just reads. */
export async function writeBannerTextOverride(
  key: BannerTextKey,
  override: BannerTextOverride,
): Promise<void> {
  const all = await readBannerTextOverrides();
  const cs = clean(override.cs);
  const en = clean(override.en);
  if (!cs && !en) all.delete(key);
  else all.set(key, { ...(cs ? { cs } : {}), ...(en ? { en } : {}) });

  // Serialise in the canonical banner order for stable, reviewable diffs.
  const obj: Record<string, BannerTextOverride> = {};
  for (const { key: k } of BANNER_TEXT_KEYS) {
    const v = all.get(k);
    if (v) obj[k] = v;
  }
  await ensureDir(ADMIN_DIR);
  await atomicWrite(FILE, `${JSON.stringify(obj, null, 2)}\n`);
}
