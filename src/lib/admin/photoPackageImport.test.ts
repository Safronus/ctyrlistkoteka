import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * End-to-end import of a location-photo package, against a real temporary
 * DATA_DIR / GENERATED_DIR and real sharp encoding.
 *
 * The parts worth this much setup are exactly the ones a unit test cannot
 * reach: that the 10 MB PNG becomes a pair of WebPs, that a re-import
 * replaces rather than piles up, that a replaced file is recoverable from
 * the trash, and that a location the database does not know is refused
 * instead of writing a photo nothing can ever show.
 */

const LOCATIONS = [
  { id: 10, displayName: "Zlín — Čepkov", code: "ZLÍN_ČEPKOV001" },
  { id: 126, displayName: "Ratiboř — pole", code: "RATIBOŘ_POLE001" },
];

vi.mock("@/lib/db", () => ({
  prisma: {
    location: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: number[] } } }) =>
        LOCATIONS.filter((l) => where.id.in.includes(l.id)),
      ),
    },
  },
}));

let tmp: string;

/** A tiny but real photo, so sharp has something honest to re-encode. */
async function png(width = 40, height = 30): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 30, g: 160, b: 90 },
    },
  })
    .png()
    .toBuffer();
}

async function buildZip(
  entries: Array<{ number: string; order: number; caption?: string }>,
  opts: { typ?: string; extraFile?: string } = {},
): Promise<string> {
  const zip = new JSZip();
  const fotky = [];
  for (const e of entries) {
    const name = `${e.number}_foto${String(e.order).padStart(3, "0")}.png`;
    const zipPath = `location-photos/${e.number}/${name}`;
    zip.file(zipPath, await png());
    fotky.push({
      cislo_lokace: e.number,
      soubor: zipPath,
      poradi: e.order,
      popisek: e.caption ?? "",
      pocet_ploch: 1,
      plochy_vypalene: true,
    });
  }
  if (opts.extraFile) zip.file(opts.extraFile, await png());
  zip.file(
    "manifest.json",
    JSON.stringify({
      typ: opts.typ ?? "fotky-lokaci",
      vytvoreno: "2026-08-22 23:03:39",
      pocet_fotek: fotky.length,
      schema_metadat: 1,
      plochy_vypalene: true,
      originaly_prilozeny: false,
      fotky,
    }),
  );
  const out = path.join(tmp, `pkg-${Math.random().toString(36).slice(2)}.zip`);
  await fs.writeFile(out, await zip.generateAsync({ type: "nodebuffer" }));
  return out;
}

/** Imports run against a throwaway tree, so nothing here can touch the
 *  real collection — and the modules read their roots at import time. */
async function loadModule() {
  vi.resetModules();
  vi.stubEnv("DATA_DIR", path.join(tmp, "data"));
  vi.stubEnv("GENERATED_DIR", path.join(tmp, "generated"));
  return import("./photoPackageImport");
}

function photosDir(): string {
  return path.join(tmp, "generated", "location-photos");
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "photo-pkg-"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("analyzePhotoPackageZip", () => {
  it("recognises the package and reads it per location", async () => {
    const mod = await loadModule();
    const zip = await buildZip([
      { number: "00010", order: 1, caption: "pohled od cesty" },
      { number: "00010", order: 2 },
      { number: "00126", order: 1 },
    ]);
    expect(await mod.isPhotoPackageZip(zip)).toBe(true);

    const plan = await mod.analyzePhotoPackageZip(zip);
    expect("error" in plan).toBe(false);
    if ("error" in plan) return;
    expect(plan.totalPhotos).toBe(3);
    expect(plan.add).toBe(3);
    expect(plan.replace).toBe(0);
    expect(plan.locations).toHaveLength(2);
    expect(plan.locations[0]).toMatchObject({
      number: "00010",
      locationId: 10,
      locationName: "Zlín — Čepkov",
    });
    expect(plan.locations[0]!.photos[0]).toMatchObject({
      order: 1,
      caption: "pohled od cesty",
      storedName: "00010_foto001.webp",
      action: "add",
    });
  });

  it("refuses a map package rather than misreading it", async () => {
    const mod = await loadModule();
    const zip = await buildZip([{ number: "00010", order: 1 }], {
      typ: "lokacni-mapy",
    });
    expect(await mod.isPhotoPackageZip(zip)).toBe(false);
  });

  it("names locations the web does not know, and lists stray files", async () => {
    const mod = await loadModule();
    const zip = await buildZip(
      [
        { number: "00010", order: 1 },
        { number: "99999", order: 1 },
      ],
      { extraFile: "location-photos/00010/nahodny.png" },
    );
    const plan = await mod.analyzePhotoPackageZip(zip);
    if ("error" in plan) throw new Error(plan.error);
    expect(plan.unknownNumbers).toEqual(["99999"]);
    expect(plan.orphanFiles).toEqual(["location-photos/00010/nahodny.png"]);
  });
});

describe("commitPhotoPackageZip", () => {
  const opts = { collision: "overwrite" as const, replaceManual: false };

  it("writes a WebP pair per photo and a caption file", async () => {
    const mod = await loadModule();
    const zip = await buildZip([
      { number: "00010", order: 1, caption: "pohled od cesty" },
      { number: "00010", order: 2 },
    ]);
    const summary = await mod.commitPhotoPackageZip(zip, opts);
    expect(summary.errors).toEqual([]);
    expect(summary.imported).toBe(2);
    expect(summary.replaced).toBe(0);

    const web = path.join(photosDir(), "00010_foto001.webp");
    const thumb = path.join(photosDir(), "thumb", "00010_foto001.webp");
    expect((await sharp(web).metadata()).format).toBe("webp");
    expect((await sharp(thumb).metadata()).format).toBe("webp");
    // The PNG itself is never kept — it is a 10 MB master on the desktop.
    const names = await fs.readdir(photosDir());
    expect(names.filter((n) => n.endsWith(".png"))).toEqual([]);

    const captions = JSON.parse(
      await fs.readFile(
        path.join(tmp, "data", ".admin", "location-photos.json"),
        "utf8",
      ),
    ) as Record<string, Record<string, string>>;
    expect(captions["00010"]).toEqual({ "1": "pohled od cesty" });
  });

  it("replaces on a re-import and keeps the old file in the trash", async () => {
    const mod = await loadModule();
    await mod.commitPhotoPackageZip(
      await buildZip([{ number: "00010", order: 1 }]),
      opts,
    );
    const again = await mod.commitPhotoPackageZip(
      await buildZip([{ number: "00010", order: 1, caption: "nový popisek" }]),
      opts,
    );
    expect(again.replaced).toBe(1);
    expect(again.imported).toBe(0);
    // One photo, not two — a re-import must not pile up copies.
    const names = (await fs.readdir(photosDir())).filter((n) =>
      n.endsWith(".webp"),
    );
    expect(names).toEqual(["00010_foto001.webp"]);
    // …and the replaced one is recoverable.
    const trash = path.join(tmp, "data", ".trash");
    const stamps = await fs.readdir(trash);
    const kept = await fs.readdir(
      path.join(trash, stamps[0]!, "location-photos"),
    );
    expect(kept).toEqual(["00010_foto001.webp"]);
  });

  it("honours 'skip' and leaves the existing photo alone", async () => {
    const mod = await loadModule();
    await mod.commitPhotoPackageZip(
      await buildZip([{ number: "00010", order: 1 }]),
      opts,
    );
    const before = await fs.readFile(
      path.join(photosDir(), "00010_foto001.webp"),
    );
    const again = await mod.commitPhotoPackageZip(
      await buildZip([{ number: "00010", order: 1 }]),
      { collision: "skip", replaceManual: false },
    );
    expect(again.skipped).toBe(1);
    expect(again.replaced).toBe(0);
    const after = await fs.readFile(
      path.join(photosDir(), "00010_foto001.webp"),
    );
    expect(after.equals(before)).toBe(true);
  });

  it("writes nothing for a location the database does not know", async () => {
    const mod = await loadModule();
    const summary = await mod.commitPhotoPackageZip(
      await buildZip([{ number: "99999", order: 1 }]),
      opts,
    );
    expect(summary.imported).toBe(0);
    expect(summary.skipped).toBe(1);
    const names = await fs.readdir(photosDir()).catch(() => []);
    expect(names.filter((n) => n.endsWith(".webp"))).toEqual([]);
  });

  it("leaves a hand-uploaded photo alone unless asked", async () => {
    const mod = await loadModule();
    const manual = path.join(photosDir(), "ZLÍN_ČEPKOV+00010_reálné foto.png");
    await fs.mkdir(photosDir(), { recursive: true });
    await fs.writeFile(manual, await png());

    await mod.commitPhotoPackageZip(
      await buildZip([{ number: "00010", order: 1 }]),
      opts,
    );
    expect(await fs.readdir(photosDir())).toContain(
      "ZLÍN_ČEPKOV+00010_reálné foto.png",
    );

    const withReplace = await mod.commitPhotoPackageZip(
      await buildZip([{ number: "00010", order: 1 }]),
      { collision: "overwrite", replaceManual: true },
    );
    expect(withReplace.manualTrashed).toBe(1);
    expect(await fs.readdir(photosDir())).not.toContain(
      "ZLÍN_ČEPKOV+00010_reálné foto.png",
    );
  });
});
