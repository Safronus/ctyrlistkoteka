import type { Metadata } from "next";
import { QrCode } from "lucide-react";
import { ensureAdminAuth } from "@/lib/admin/guard";
import { prisma } from "@/lib/db";
import { FindState } from "@/generated/prisma/client";
import { qrTargetLabel } from "@/lib/admin/qrTargets";
import { readQrPrefs } from "@/lib/admin/qrPrefs";
import { COLLECTION_TIME_ZONE } from "@/lib/collectionTime";
import { QrGeneratorForm } from "./qr-generator-form";
import { QrList, type QrListItem } from "./qr-list";
import { FindQrSection } from "./find-qr-section";
import { type FindQrListItem } from "./find-qr-list";
import { QrTabs } from "./qr-tabs";
import type { FindQrInput } from "./qr-types";

export const metadata: Metadata = {
  title: "QR kódy",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function AdminQrPage({
  searchParams,
}: {
  /** `?ids=101-103,201` — the file list hands its selection over here
   *  instead of carrying a second QR generator of its own. */
  searchParams: Promise<{ ids?: string | string[] }>;
}) {
  await ensureAdminAuth();
  const { ids: rawIds } = await searchParams;
  const initialSpec = (Array.isArray(rawIds) ? rawIds[0] : rawIds) ?? "";

  const now = Date.now();
  const since7 = new Date(now - 7 * DAY_MS);
  const since30 = new Date(now - 30 * DAY_MS);

  const [pageItems, findItems, prefs] = await Promise.all([
    loadPageCodes(since7, since30),
    loadFindCodes(since7, since30),
    readQrPrefs(),
  ]);

  const findScans = findItems.reduce((s, c) => s + c.scansTotal, 0);
  const findActive = findItems.filter((c) => !c.revoked).length;
  const pageScans = pageItems.reduce((s, c) => s + c.scansTotal, 0);
  const pageActive = pageItems.filter((c) => !c.archived).length;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
          <QrCode className="h-5 w-5 text-brand-600" aria-hidden />
          QR kódy sbírky
        </h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Dvě nezávislé sady: kódy na jednotlivé nálezy a kódy na veřejné
          stránky. Obě se dají trackovat.
        </p>
      </header>

      <QrTabs
        findLabel={`QR nálezů (${findItems.length.toLocaleString("cs-CZ")})`}
        findSummary={
          <>
            <Summary value={findActive} label="aktivních QR" />
            <Summary value={findScans} label="naskenování" />
          </>
        }
        findPanel={
          <section className="space-y-4 rounded-xl border border-brand-200 bg-brand-50/40 p-4 sm:p-5">
            <p className="text-xs text-gray-600">
              Na kartičku k darovanému čtyřlístku. Kód vede na{" "}
              <span className="font-mono">/n/&lt;číslo&gt;</span>, což
              naskenování započítá a přesměruje na detail nálezu. Adresa je pro
              dané číslo trvalá — dotisk vyjde vždy stejně a už rozdané kartičky
              platí dál.
            </p>
            <FindQrSection
              items={findItems}
              pxPerCm={prefs.pxPerCm}
              calibrated={prefs.calibrated}
              initialCfg={prefs.form as unknown as FindQrInput}
              initialSizeCm={prefs.sizeCm}
              // Sanitised here rather than trusted: the value lands straight
              // in a textarea and is re-parsed server-side anyway, but there
              // is no reason to echo anything but the range grammar back.
              initialSpec={initialSpec
                .replace(/[^\d,\-\s]/g, "")
                .slice(0, 4000)}
            />
          </section>
        }
        pageLabel={`QR stránek (${pageItems.length.toLocaleString("cs-CZ")})`}
        pageSummary={
          <>
            <Summary value={pageActive} label="aktivních QR" />
            <Summary value={pageScans} label="naskenování" />
          </>
        }
        pagePanel={
          <section className="space-y-4 rounded-xl border border-gray-200 bg-gray-50/60 p-4 sm:p-5">
            <p className="text-xs text-gray-600">
              Odkaz na veřejnou stránku webu. Každý vytvořený kód dostane
              vlastní token (
              <span className="font-mono">/go/&lt;token&gt;</span>
              ), takže se naskenování počítá ke konkrétnímu QR.
            </p>

            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <QrGeneratorForm />
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Evidence
              </h3>
              <QrList items={pageItems} />
            </div>
          </section>
        }
      />
    </div>
  );
}

const dateFmt = new Intl.DateTimeFormat("cs-CZ", {
  day: "numeric",
  month: "numeric",
  year: "numeric",
  timeZone: COLLECTION_TIME_ZONE,
});

/** Full date + time for the find list. Formatted here, never in the
 *  browser: `Intl` without an explicit zone uses the RUNNING PROCESS's
 *  zone (UTC on the VPS) — the bug lib/collectionTime.ts exists to stop. */
const dateTimeFmt = new Intl.DateTimeFormat("cs-CZ", {
  day: "numeric",
  month: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: COLLECTION_TIME_ZONE,
});

async function loadPageCodes(
  since7: Date,
  since30: Date,
): Promise<QrListItem[]> {
  const codes = await prisma.qrCode.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { scans: true } } },
  });
  const [g7, g30] = await Promise.all([
    prisma.qrScan.groupBy({
      by: ["qrCodeId"],
      where: { scannedAt: { gte: since7 } },
      _count: true,
    }),
    prisma.qrScan.groupBy({
      by: ["qrCodeId"],
      where: { scannedAt: { gte: since30 } },
      _count: true,
    }),
  ]);
  const map7 = new Map(g7.map((r) => [r.qrCodeId, r._count]));
  const map30 = new Map(g30.map((r) => [r.qrCodeId, r._count]));

  return codes.map((c) => ({
    id: c.id,
    label: c.label,
    token: c.token,
    targetLabel: qrTargetLabel(c.target),
    locale: c.locale,
    createdAt: dateFmt.format(c.createdAt),
    archived: c.archivedAt !== null,
    scansTotal: c._count.scans,
    scans30: map30.get(c.id) ?? 0,
    scans7: map7.get(c.id) ?? 0,
  }));
}

/**
 * The find list is DERIVED, not stored: a find QR always exists (the id
 * is the code), so the list is "every donated find" ∪ "every find with an
 * admin record (pinned or revoked)" ∪ "anything that has actually been
 * scanned" — the last one so a card in the wild can never be invisible
 * here just because its find lost the donated state.
 */
async function loadFindCodes(
  since7: Date,
  since30: Date,
): Promise<FindQrListItem[]> {
  const [donated, records, scanned] = await Promise.all([
    prisma.findStateAssignment.findMany({
      where: { state: FindState.DONATED },
      select: { findId: true },
    }),
    prisma.findQrCode.findMany({
      select: { findId: true, pinned: true, revokedAt: true },
    }),
    prisma.findQrScan.groupBy({ by: ["findId"], _count: true }),
  ]);

  const donatedSet = new Set(donated.map((d) => d.findId));
  const recordMap = new Map(records.map((r) => [r.findId, r]));
  const ids = [
    ...new Set([
      ...donatedSet,
      ...recordMap.keys(),
      ...scanned.map((s) => s.findId),
    ]),
  ];
  if (ids.length === 0) return [];

  const [finds, g7, g30] = await Promise.all([
    prisma.find.findMany({
      where: { id: { in: ids } },
      // `notes` is the raw LSP note. Admin-only surface (auth-gated,
      // noindex), which is why it may be read directly here — the public
      // site still goes exclusively through `anonymize()`.
      select: { id: true, foundAt: true, notes: true },
      orderBy: { id: "asc" },
    }),
    prisma.findQrScan.groupBy({
      by: ["findId"],
      where: { scannedAt: { gte: since7 } },
      _count: true,
    }),
    prisma.findQrScan.groupBy({
      by: ["findId"],
      where: { scannedAt: { gte: since30 } },
      _count: true,
    }),
  ]);

  const total = new Map(scanned.map((s) => [s.findId, s._count]));
  const map7 = new Map(g7.map((s) => [s.findId, s._count]));
  const map30 = new Map(g30.map((s) => [s.findId, s._count]));

  return finds.map((f) => {
    const rec = recordMap.get(f.id);
    return {
      findId: f.id,
      note: f.notes?.trim() || null,
      foundAt: f.foundAt ? dateTimeFmt.format(f.foundAt) : null,
      donated: donatedSet.has(f.id),
      pinned: rec?.pinned ?? false,
      revoked: rec?.revokedAt != null,
      scansTotal: total.get(f.id) ?? 0,
      scans30: map30.get(f.id) ?? 0,
      scans7: map7.get(f.id) ?? 0,
    };
  });
}

function Summary({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <p className="font-mono text-xl font-bold tabular-nums text-brand-700">
        {value.toLocaleString("cs-CZ")}
      </p>
      <p className="text-[10px] uppercase tracking-wide text-gray-400">
        {label}
      </p>
    </div>
  );
}
