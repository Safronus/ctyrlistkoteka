import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * End-to-end analysis of an "oprava-nalezu" package against a real zip and a
 * throwaway DATA_DIR (live LSP, files on disk, note overrides), with the
 * database mocked. The rules themselves are covered in
 * findUpdatePackage.test.ts; this proves the plumbing feeds them the truth:
 * checksums of the actual bytes, the files really on disk, the live LSP —
 * and that the package is routed to its own importer, never to the map one.
 */

const ORIGINAL_BYTES = Buffer.from("original jpeg bytes");
const NEW_CROP_BYTES = Buffer.from("new crop jpeg bytes");
const sha1 = (b: Buffer) => createHash("sha1").update(b).digest("hex");

vi.mock("@/lib/db", () => ({
  prisma: {
    find: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: number[] } } }) =>
        where.id.in.filter((id) => id === 31650).map((id) => ({ id })),
      ),
    },
    findImage: {
      findMany: vi.fn(async () => [
        { findId: 31650, imageType: "ORIGINAL", originalSha1: sha1(ORIGINAL_BYTES) },
        { findId: 31650, imageType: "CROP", originalSha1: "c".repeat(40) },
      ]),
    },
    locationMap: {
      findMany: vi.fn(
        async ({ where }: { where: { id?: { in: number[] }; isAnonymized?: boolean } }) =>
          where.isAnonymized
            ? []
            : (where.id?.in ?? []).filter((id) => id === 298).map((id) => ({ id, locationId: 298 })),
      ),
    },
  },
}));

const NAME = "31650+00298+PT_LISABON_001+DAROVANY+NE+Pro babičku.jpg";
const OLD_NAME = "31650+00298+PT_LISABON_001+NORMÁLNÍ+NE+BezPoznámky.jpg";

let tmp: string;

async function seedDataDir() {
  const data = path.join(tmp, "data");
  await fs.mkdir(path.join(data, "meta"), { recursive: true });
  await fs.mkdir(path.join(data, "finds"), { recursive: true });
  await fs.mkdir(path.join(data, "crops"), { recursive: true });
  await fs.mkdir(path.join(data, ".admin"), { recursive: true });
  await fs.writeFile(
    path.join(data, "meta", "LokaceStavyPoznamky.json"),
    JSON.stringify({
      anonymizace: { ANONYMIZOVANE: [] },
      lokace: { "298": ["31640-31655"] },
      poznamky: { "31650": "stará" },
      stavy: { DAROVANY: [], GIGANT: ["31650"] },
    }),
  );
  await fs.writeFile(path.join(data, "finds", OLD_NAME), ORIGINAL_BYTES);
  await fs.writeFile(path.join(data, "crops", "31650.jpg"), Buffer.from("old crop"));
  await fs.writeFile(
    path.join(data, ".admin", "find-note-overrides.json"),
    JSON.stringify({ "31650": { cs: "přepis", en: "override" } }),
  );
}

async function buildZip(
  opts: { cropSha1?: string; extraFile?: string; typ?: string } = {},
): Promise<string> {
  const zip = new JSZip();
  zip.file(
    "manifest.json",
    JSON.stringify({
      typ: opts.typ ?? "oprava-nalezu",
      schema_version: 1,
      generatedAt: "2026-10-28T14:05:00",
      generator: "test",
      finds: {
        "31650": {
          original: NAME,
          crop: NAME,
          imagesIncluded: true,
          sha1: { original: sha1(ORIGINAL_BYTES), crop: opts.cropSha1 ?? sha1(NEW_CROP_BYTES) },
        },
      },
    }),
  );
  zip.file(
    "meta/LokaceStavyPoznamky.json",
    JSON.stringify({
      lokace: { "298": ["31650"] },
      stavy: {
        BEZFOTKY: [],
        BEZGPS: [],
        DAROVANY: ["31650"],
        ZTRACENY: [],
        "LOKACE-NEEXISTUJE": [],
        NEUTRZEN: [],
      },
      poznamky: { "31650": "Pro babičku" },
      anonymizace: { ANONYMIZOVANE: [] },
    }),
  );
  zip.file(`finds/${NAME}`, ORIGINAL_BYTES);
  zip.file(`crops/${NAME}`, NEW_CROP_BYTES);
  if (opts.extraFile) zip.file(opts.extraFile, Buffer.from("x"));
  const out = path.join(tmp, `pkg-${Math.random().toString(36).slice(2)}.zip`);
  await fs.writeFile(out, await zip.generateAsync({ type: "nodebuffer" }));
  return out;
}

/** The modules read their roots at import time. */
async function loadModules() {
  vi.resetModules();
  vi.stubEnv("DATA_DIR", path.join(tmp, "data"));
  vi.stubEnv("GENERATED_DIR", path.join(tmp, "generated"));
  return {
    update: await import("./findUpdateImport"),
    maps: await import("./mapPackageImport"),
    photos: await import("./photoPackageImport"),
  };
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "find-update-"));
  await seedDataDir();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("package routing", () => {
  it("is recognised as an update package and by no other importer", async () => {
    const { update, maps, photos } = await loadModules();
    const zip = await buildZip();
    expect(await update.isFindUpdatePackageZip(zip)).toBe(true);
    // The reason the contract uses `typ`: a manifest the map importer can't
    // place would otherwise be taken for a map package.
    expect(await maps.isMapPackageZip(zip)).toBe(false);
    expect(await photos.isPhotoPackageZip(zip)).toBe(false);
  });

  it("does not claim other manifests", async () => {
    const { update } = await loadModules();
    expect(await update.isFindUpdatePackageZip(await buildZip({ typ: "lokacni-mapy" }))).toBe(false);
  });
});

describe("analyzeFindUpdateZip", () => {
  it("reads the real bytes, disk and live LSP into the plan", async () => {
    const { update } = await loadModules();
    const plan = await update.analyzeFindUpdateZip(await buildZip());
    if ("error" in plan) throw new Error(plan.error);
    expect(plan.errors).toEqual([]);
    expect(plan.ok).toBe(true);
    const f = plan.finds[0]!;
    expect(f.before.original).toBe(OLD_NAME);
    expect(f.before.crop).toBe("31650.jpg");
    expect(f.before.states).toEqual(["GIGANT"]);
    expect(f.after.states).toEqual(["DAROVANY", "GIGANT"]);
    // Original bytes equal the DB checksum → rename only; crop is new.
    expect(f.images).toEqual({ original: "same", crop: "changed" });
    expect(f.noteOverride).toBe("removed");
  });

  it("checks the manifest's checksum against the actual bytes (V8)", async () => {
    const { update } = await loadModules();
    const plan = await update.analyzeFindUpdateZip(await buildZip({ cropSha1: "d".repeat(40) }));
    if ("error" in plan) throw new Error(plan.error);
    expect(plan.ok).toBe(false);
    expect(plan.finds[0]!.errors.join()).toMatch(/V8: ořez/);
  });

  it("refuses files the manifest doesn't list (V4)", async () => {
    const { update } = await loadModules();
    const plan = await update.analyzeFindUpdateZip(await buildZip({ extraFile: "finds/31651.jpg" }));
    if ("error" in plan) throw new Error(plan.error);
    expect(plan.ok).toBe(false);
    expect(plan.errors.join()).toMatch(/V4: soubor finds\/31651\.jpg/);
  });

  it("stops when the live LSP can't be read", async () => {
    const { update } = await loadModules();
    await fs.rm(path.join(tmp, "data", "meta", "LokaceStavyPoznamky.json"));
    const plan = await update.analyzeFindUpdateZip(await buildZip());
    expect("error" in plan && plan.error).toMatch(/nejde přečíst/);
  });

  it("writes nothing", async () => {
    const { update } = await loadModules();
    const before = await snapshot(path.join(tmp, "data"));
    await update.analyzeFindUpdateZip(await buildZip());
    expect(await snapshot(path.join(tmp, "data"))).toEqual(before);
  });
});

/** Every file under `dir` with its contents, to prove nothing changed. */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const e of await fs.readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!e.isFile()) continue;
    const abs = path.join(e.parentPath, e.name);
    out[path.relative(dir, abs)] = (await fs.readFile(abs)).toString("base64");
  }
  return out;
}
