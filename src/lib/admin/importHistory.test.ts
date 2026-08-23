import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The history is written by an import that must not care whether the
 * write worked, and read by a page that must not care what a crash left
 * behind. Both halves of that contract are worth pinning down.
 */

let tmp: string;

async function load() {
  vi.resetModules();
  vi.stubEnv("DATA_DIR", path.join(tmp, "data"));
  vi.stubEnv("ADMIN_SECURE_DIR", path.join(tmp, "secure"));
  return import("./importHistory");
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "import-history-"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(tmp, { recursive: true, force: true });
});

const EVENT = {
  uploadId: "u1",
  fileName: "balicek.zip",
  bytes: 1024,
  packageType: "photos" as const,
  outcome: "analyzed" as const,
};

describe("readImportHistory", () => {
  it("is empty before anything was ever imported", async () => {
    const { readImportHistory } = await load();
    await expect(readImportHistory()).resolves.toEqual([]);
  });

  it("returns events newest first", async () => {
    const { recordImportEvent, readImportHistory } = await load();
    await recordImportEvent({ ...EVENT, at: "2026-08-23T10:00:00.000Z" });
    await recordImportEvent({
      ...EVENT,
      at: "2026-08-23T10:05:00.000Z",
      outcome: "committed",
      summary: "2 fotky pro 1 lokalitu",
    });

    const rows = await readImportHistory();
    expect(rows.map((r) => r.outcome)).toEqual(["committed", "analyzed"]);
    expect(rows[0]?.summary).toBe("2 fotky pro 1 lokalitu");
  });

  it("skips a half-written line instead of losing the file", async () => {
    const { recordImportEvent, readImportHistory, historyFilePath } =
      await load();
    await recordImportEvent({ ...EVENT, at: "2026-08-23T10:00:00.000Z" });
    // What a crash mid-append leaves behind.
    await fs.appendFile(historyFilePath(), '{"at":"2026-08-23T10:01', "utf8");

    const rows = await readImportHistory();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.uploadId).toBe("u1");
  });

  it("honours the limit", async () => {
    const { recordImportEvent, readImportHistory } = await load();
    for (let i = 0; i < 5; i++) {
      await recordImportEvent({ ...EVENT, uploadId: `u${i}` });
    }
    await expect(readImportHistory(2)).resolves.toHaveLength(2);
  });

  it("keeps growth bounded once the log runs away", async () => {
    const { recordImportEvent, readImportHistory, historyFilePath } =
      await load();
    // 400 entries of padding push the file past the rewrite threshold.
    const fat = "x".repeat(700);
    for (let i = 0; i < 400; i++) {
      await recordImportEvent({ ...EVENT, uploadId: `u${i}`, summary: fat });
    }

    const kept = (await fs.readFile(historyFilePath(), "utf8"))
      .split("\n")
      .filter((l) => l.trim().length > 0);
    // The count sits between MAX_ENTRIES and the next time the size
    // threshold is crossed — the point is that 400 appends did not leave
    // 400 lines behind.
    expect(kept.length).toBeGreaterThanOrEqual(200);
    expect(kept.length).toBeLessThan(400);
    // The trim drops the OLDEST lines, so the last import survives.
    const rows = await readImportHistory(1);
    expect(rows[0]?.uploadId).toBe("u399");
  });
});
