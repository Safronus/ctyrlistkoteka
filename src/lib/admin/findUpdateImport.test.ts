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

// Switches the tests flip: an admin sync "running", and a backup that fails
// (the last step before the LSP write — to prove the rollback).
const flags = vi.hoisted(() => ({ syncRunning: false, failBackup: false, tickingClock: false }));

// Trash buckets are named by the second (trashTimestamp). With
// `tickingClock`, every call returns the next second — the slow-machine case
// where a commit straddles a second boundary, made deterministic.
vi.mock("./atomic", async (importOriginal) => {
  const real = await importOriginal<typeof import("./atomic")>();
  let tick = 0;
  return {
    ...real,
    trashTimestamp: vi.fn(() =>
      flags.tickingClock ? `20261028T1200${String(tick++ % 60).padStart(2, "0")}` : real.trashTimestamp(),
    ),
  };
});

vi.mock("./syncRunner", () => ({
  getStatus: vi.fn(async () => (flags.syncRunning ? { state: "running" } : null)),
}));

vi.mock("./lspBackups", async (importOriginal) => {
  const real = await importOriginal<typeof import("./lspBackups")>();
  return {
    ...real,
    createBackup: vi.fn(async () => {
      if (flags.failBackup) throw new Error("disk full (test)");
      return real.createBackup();
    }),
  };
});

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
  flags.syncRunning = false;
  flags.failBackup = false;
  flags.tickingClock = false;
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

describe("commitFindUpdateZip", () => {
  const data = () => path.join(tmp, "data");
  const ls = async (sub: string) => (await fs.readdir(path.join(data(), sub))).sort();
  const liveLsp = async () =>
    JSON.parse(await fs.readFile(path.join(data(), "meta", "LokaceStavyPoznamky.json"), "utf8"));

  it("applies the correction: rename same bytes, write new, trash old, LSP last", async () => {
    const { update } = await loadModules();
    const r = await update.commitFindUpdateZip(await buildZip());
    if ("error" in r) throw new Error(r.error);
    // Original bytes were already on disk → renamed; the crop is new.
    expect(r.summary).toMatchObject({ finds: 1, renamed: 1, written: 1, unchanged: 0, trashed: 1, noteOverridesRemoved: 1 });
    expect(await ls("finds")).toEqual([NAME]);
    expect(await ls("crops")).toEqual([NAME]);
    expect(await fs.readFile(path.join(data(), "finds", NAME))).toEqual(ORIGINAL_BYTES);
    expect(await fs.readFile(path.join(data(), "crops", NAME))).toEqual(NEW_CROP_BYTES);

    const lspNow = await liveLsp();
    expect(lspNow.stavy.DAROVANY).toEqual(["31650"]);
    expect(lspNow.stavy.GIGANT).toEqual(["31650"]); // the web's own key, kept
    expect(lspNow.poznamky).toEqual({ "31650": "Pro babičku" });
    expect(lspNow.lokace["298"]).toEqual(["31640-31655"]);

    // R8: the override is gone.
    const overrides = JSON.parse(await fs.readFile(path.join(data(), ".admin", "find-note-overrides.json"), "utf8"));
    expect(overrides["31650"]).toBeUndefined();

    // The old crop and the previous LSP are recoverable from the trash.
    const bucket = path.join(data(), ".trash", r.summary.trashBucket!);
    expect((await fs.readdir(path.join(bucket, "crops"))).sort()).toEqual(["31650.jpg"]);
    expect(await fs.readdir(path.join(bucket, "meta"))).toEqual(["LokaceStavyPoznamky.json"]);
  });

  it("keeps one commit in ONE trash bucket even when the clock ticks between steps", async () => {
    // Was flaky (≈1 in 25 full runs): each trash scope took its own
    // timestamp, so a commit crossing a second split into two buckets and
    // the reported bucket lacked the LSP snapshot.
    flags.tickingClock = true;
    try {
      const { update } = await loadModules();
      const r = await update.commitFindUpdateZip(await buildZip());
      if ("error" in r) throw new Error(r.error);
      const buckets = await fs.readdir(path.join(data(), ".trash"));
      expect(buckets).toEqual([r.summary.trashBucket]);
      const bucket = path.join(data(), ".trash", r.summary.trashBucket!);
      expect((await fs.readdir(bucket)).sort()).toEqual(["crops", "meta"]);
    } finally {
      flags.tickingClock = false;
    }
  });

  it("is idempotent — the same package again changes nothing", async () => {
    const { update } = await loadModules();
    const zip = await buildZip();
    const first = await update.commitFindUpdateZip(zip);
    if ("error" in first) throw new Error(first.error);
    const files = { finds: await ls("finds"), crops: await ls("crops") };
    const lspFirst = await liveLsp();
    const second = await update.commitFindUpdateZip(zip);
    if ("error" in second) throw new Error(second.error);
    expect(second.summary).toMatchObject({ renamed: 0, written: 0, unchanged: 2, trashed: 0, noteOverridesRemoved: 0 });
    expect({ finds: await ls("finds"), crops: await ls("crops") }).toEqual(files);
    expect(await liveLsp()).toEqual(lspFirst);
  });

  it("refuses a package with errors and writes nothing", async () => {
    const { update } = await loadModules();
    const before = await snapshot(data());
    const r = await update.commitFindUpdateZip(await buildZip({ cropSha1: "d".repeat(40) }));
    expect("error" in r && r.error).toMatch(/neprošel kontrolami/);
    expect(await snapshot(data())).toEqual(before);
  });

  it("refuses while an admin sync is running", async () => {
    const { update } = await loadModules();
    flags.syncRunning = true;
    const before = await snapshot(data());
    const r = await update.commitFindUpdateZip(await buildZip());
    expect("error" in r && r.error).toMatch(/běží sync/);
    expect(await snapshot(data())).toEqual(before);
  });

  it("rolls everything back when the last step fails", async () => {
    const { update } = await loadModules();
    // Compare everything except the trash, where the rollback copies stay.
    const outsideTrash = async () =>
      Object.fromEntries(Object.entries(await snapshot(data())).filter(([k]) => !k.startsWith(".trash")));
    const before = await outsideTrash();
    flags.failBackup = true;
    const r = await update.commitFindUpdateZip(await buildZip());
    expect("error" in r && r.error).toMatch(/vše jsem vrátil do původního stavu/);
    expect(await outsideTrash()).toEqual(before);
  });

  it("accepts a live LSP carrying the exporter's metadata block", async () => {
    const { update } = await loadModules();
    const file = path.join(data(), "meta", "LokaceStavyPoznamky.json");
    await fs.writeFile(file, JSON.stringify({ ...(await liveLsp()), metadata: { exportedBy: "desktop" } }));
    const plan = await update.analyzeFindUpdateZip(await buildZip());
    if ("error" in plan) throw new Error(plan.error);
    expect(plan.ok).toBe(true);
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
