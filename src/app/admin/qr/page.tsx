import type { Metadata } from "next";
import { QrCode, Leaf } from "lucide-react";
import { ensureAdminAuth } from "@/lib/admin/guard";
import { prisma } from "@/lib/db";
import { FindState } from "@/generated/prisma/client";
import { qrTargetLabel } from "@/lib/admin/qrTargets";
import { readQrPrefs } from "@/lib/admin/qrPrefs";
import { COLLECTION_TIME_ZONE } from "@/lib/collectionTime";
import { QrGeneratorForm } from "./qr-generator-form";
import { QrList, type QrListItem } from "./qr-list";
import { FindQrForm } from "./find-qr-form";
import { FindQrList, type FindQrListItem } from "./find-qr-list";

export const metadata: Metadata = {
  title: "QR kódy",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function AdminQrPage() {
  await ensureAdminAuth();

  const now = Date.now();
  const since7 = new Date(now - 7 * DAY_MS);
  const since30 = new Date(now - 30 * DAY_MS);

  const [pageItems, findItems, prefs] = await Promise.all([
    loadPageCodes(since7, since30),
    loadFindCodes(since7, since30),
    readQrPrefs(),
  ]);

  const totalScans =
    pageItems.reduce((s, c) => s + c.scansTotal, 0) +
    findItems.reduce((s, c) => s + c.scansTotal, 0);
  const activeCount = pageItems.filter((c) => !c.archived).length;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
            <QrCode className="h-5 w-5 text-brand-600" aria-hidden />
            QR kódy sbírky
          </h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Dvě nezávislé sady: kódy na veřejné stránky a kódy na jednotlivé
            nálezy. Obě se dají trackovat.
          </p>
        </div>
        <div className="flex items-center gap-4 text-center">
          <Summary value={activeCount} label="aktivních QR stránek" />
          <Summary value={totalScans} label="naskenování" />
        </div>
      </header>

      {/* ============================================ QR kódy nálezů */}
      <section className="space-y-4 rounded-xl border border-brand-200 bg-brand-50/40 p-4 sm:p-5">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <Leaf className="h-4 w-4 text-brand-600" aria-hidden />
            QR kódy nálezů
          </h2>
          <p className="mt-0.5 text-xs text-gray-600">
            Na kartičku k darovanému čtyřlístku. Kód vede na{" "}
            <span className="font-mono">/n/&lt;číslo&gt;</span>, což naskenování
            započítá a přesměruje na detail nálezu. Adresa je pro dané číslo
            trvalá — dotisk vyjde vždy stejně a už rozdané kartičky platí dál.
          </p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <FindQrForm pxPerCm={prefs.pxPerCm} calibrated={prefs.calibrated} />
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Seznam
          </h3>
          <FindQrList items={findItems} />
        </div>
      </section>

      {/* ========================================== QR kódy na stránky */}
      <section className="space-y-4 rounded-xl border border-gray-200 bg-gray-50/60 p-4 sm:p-5">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <QrCode className="h-4 w-4 text-gray-500" aria-hidden />
            QR kódy na stránky
          </h2>
          <p className="mt-0.5 text-xs text-gray-600">
            Odkaz na veřejnou stránku webu. Každý vytvořený kód dostane vlastní
            token (<span className="font-mono">/go/&lt;token&gt;</span>), takže
            se naskenování počítá ke konkrétnímu QR.
          </p>
        </div>

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
    </div>
  );
}

const dateFmt = new Intl.DateTimeFormat("cs-CZ", {
  day: "numeric",
  month: "numeric",
  year: "numeric",
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
 * is the code), so the list is "every donated find" ∪ "every explicitly
 * pinned find" ∪ "anything that has actually been scanned" — the last one
 * so a card in the wild can never be invisible here just because its find
 * lost the donated state.
 */
async function loadFindCodes(
  since7: Date,
  since30: Date,
): Promise<FindQrListItem[]> {
  const [donated, pins, scanned] = await Promise.all([
    prisma.findStateAssignment.findMany({
      where: { state: FindState.DONATED },
      select: { findId: true },
    }),
    prisma.findQrPin.findMany({ select: { findId: true } }),
    prisma.findQrScan.groupBy({ by: ["findId"], _count: true }),
  ]);

  const donatedSet = new Set(donated.map((d) => d.findId));
  const pinnedSet = new Set(pins.map((p) => p.findId));
  const ids = [
    ...new Set([...donatedSet, ...pinnedSet, ...scanned.map((s) => s.findId)]),
  ];
  if (ids.length === 0) return [];

  const [finds, g7, g30] = await Promise.all([
    prisma.find.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        foundAt: true,
        location: { select: { displayName: true } },
      },
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

  return finds.map((f) => ({
    findId: f.id,
    locationName: f.location?.displayName ?? null,
    foundAt: f.foundAt ? dateFmt.format(f.foundAt) : null,
    donated: donatedSet.has(f.id),
    pinned: pinnedSet.has(f.id),
    scansTotal: total.get(f.id) ?? 0,
    scans30: map30.get(f.id) ?? 0,
    scans7: map7.get(f.id) ?? 0,
  }));
}

function Summary({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <p className="font-mono text-2xl font-bold tabular-nums text-brand-700">
        {value.toLocaleString("cs-CZ")}
      </p>
      <p className="text-[11px] uppercase tracking-wide text-gray-400">
        {label}
      </p>
    </div>
  );
}
