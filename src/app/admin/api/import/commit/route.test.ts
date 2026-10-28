import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The correction-package branch of the import commit: once the package is on
 * disk, the route starts the full sync itself (F3). A refused start must not
 * turn a committed correction into a failed import, and a failed commit must
 * never start a sync. Everything below the route is mocked — the importer
 * has its own tests.
 */

const UPLOAD_ID = "0123456789abcdef0123456789abcdef";

const mocks = vi.hoisted(() => ({
  commit: vi.fn(),
  startRun: vi.fn(),
  appendAudit: vi.fn(async () => {}),
  recordImportEvent: vi.fn(async () => {}),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  return {
    ...real,
    promises: { ...real.promises, stat: vi.fn(async () => ({ size: 1234 })) },
  };
});
vi.mock("@/lib/admin/session", () => ({
  getAdminSession: vi.fn(async () => ({ credentialLabel: "test-key" })),
  isAuthenticated: vi.fn(() => true),
  getRequestIp: vi.fn(async () => "127.0.0.1"),
  touchSession: vi.fn(async () => {}),
}));
vi.mock("@/lib/admin/audit", () => ({ appendAudit: mocks.appendAudit }));
vi.mock("@/lib/admin/importHistory", () => ({
  recordImportEvent: mocks.recordImportEvent,
}));
vi.mock("@/lib/admin/importPackage", () => ({
  isValidUploadId: (id: string) => id === UPLOAD_ID,
  importZipPath: (id: string) => `/tmp/${id}.zip`,
  cleanupImportUpload: vi.fn(async () => {}),
}));
vi.mock("@/lib/admin/findUpdateImport", () => ({
  isFindUpdatePackageZip: vi.fn(async () => true),
  commitFindUpdateZip: mocks.commit,
}));
vi.mock("@/lib/admin/syncRunner", () => ({ startRun: mocks.startRun }));
// The other package kinds are never reached for a correction package.
vi.mock("@/lib/admin/importZip", () => ({ commitImportFiles: vi.fn() }));
vi.mock("@/lib/admin/mapPackageImport", () => ({
  isMapPackageZip: vi.fn(),
  commitMapPackage: vi.fn(),
}));
vi.mock("@/lib/admin/photoPackageImport", () => ({
  isPhotoPackageZip: vi.fn(),
  commitPhotoPackageZip: vi.fn(),
}));
vi.mock("@/app/admin/json/lokace-stavy-poznamky/merge-whole-action", () => ({
  mergeWholeFile: vi.fn(),
}));

const { POST } = await import("./route");

const SUMMARY = {
  finds: 3,
  renamed: 6,
  written: 0,
  unchanged: 0,
  trashed: 0,
  noteOverridesRemoved: 0,
  trashBucket: null,
};

function request(): NextRequest {
  return new Request("http://localhost/admin/api/import/commit", {
    method: "POST",
    body: JSON.stringify({ uploadId: UPLOAD_ID, fileName: "oprava.zip" }),
  }) as unknown as NextRequest;
}

function syncAudits() {
  return mocks.appendAudit.mock.calls
    .map((c) => (c as unknown[])[0] as { action: string; details: Record<string, unknown> })
    .filter((e) => e.action === "sync.start");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.commit.mockResolvedValue({ summary: SUMMARY });
  mocks.startRun.mockResolvedValue({ runId: "20261028-120000", args: ["scripts/sync.ts"] });
});

describe("POST /admin/api/import/commit — correction package", () => {
  it("starts a full, real sync after the commit and reports its run id", async () => {
    const res = await POST(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      packageType: "update",
      updateSummary: SUMMARY,
      updateSync: { started: true, runId: "20261028-120000" },
    });
    expect(mocks.startRun).toHaveBeenCalledTimes(1);
    expect(mocks.startRun).toHaveBeenCalledWith({ dryRun: false, startedBy: "test-key" });
    // The files go first, the sync second.
    const [commitOrder] = mocks.commit.mock.invocationCallOrder;
    const [syncOrder] = mocks.startRun.mock.invocationCallOrder;
    expect(commitOrder).toBeLessThan(syncOrder!);
    expect(syncAudits()).toEqual([
      expect.objectContaining({
        details: expect.objectContaining({
          runId: "20261028-120000",
          trigger: "import-find-update",
        }),
      }),
    ]);
  });

  it("keeps the import committed when the sync refuses to start", async () => {
    mocks.startRun.mockRejectedValue(new Error("Sync už běží."));

    const res = await POST(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      updateSync: { started: false, reason: "Sync už běží." },
    });
    expect(mocks.recordImportEvent).toHaveBeenCalledWith(
      expect.objectContaining({ packageType: "update", outcome: "committed" }),
    );
    expect(syncAudits()).toEqual([
      expect.objectContaining({
        details: expect.objectContaining({ outcome: "rejected", trigger: "import-find-update" }),
      }),
    ]);
  });

  it("never starts a sync when the correction itself was refused", async () => {
    mocks.commit.mockResolvedValue({ error: "Balíček obsahuje chyby." });

    const res = await POST(request());

    expect(res.status).toBe(409);
    expect(mocks.startRun).not.toHaveBeenCalled();
    expect(syncAudits()).toEqual([]);
  });
});
