import type { Metadata } from "next";
import { QrCode } from "lucide-react";
import { ensureAdminAuth } from "@/lib/admin/guard";
import { prisma } from "@/lib/db";
import { qrTargetLabel } from "@/lib/admin/qrTargets";
import { QrGeneratorForm } from "./qr-generator-form";
import { QrList, type QrListItem } from "./qr-list";

export const metadata: Metadata = {
  title: "QR kódy",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function AdminQrPage() {
  await ensureAdminAuth();

  const codes = await prisma.qrCode.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { scans: true } } },
  });

  // Recent scan windows (per code) — two small grouped counts. `now` is
  // request time (force-dynamic page, plain Node runtime).
  const now = Date.now();
  const since7 = new Date(now - 7 * DAY_MS);
  const since30 = new Date(now - 30 * DAY_MS);
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

  const dateFmt = new Intl.DateTimeFormat("cs-CZ", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  });

  const items: QrListItem[] = codes.map((c) => ({
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

  const totalScans = codes.reduce((s, c) => s + c._count.scans, 0);
  const activeCount = codes.filter((c) => c.archivedAt === null).length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
            <QrCode className="h-5 w-5 text-brand-600" aria-hidden />
            QR kódy sbírky
          </h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Vygeneruj QR odkazující na veřejné stránky. Každý vytvořený kód
            má vlastní token (/go/&lt;token&gt;), takže se naskenování počítá
            ke konkrétnímu QR.
          </p>
        </div>
        <div className="flex items-center gap-4 text-center">
          <Summary value={activeCount} label="aktivních QR" />
          <Summary value={totalScans} label="naskenování" />
        </div>
      </header>

      <section className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
        <h2 className="mb-4 text-sm font-semibold text-gray-900">
          Nový QR kód
        </h2>
        <QrGeneratorForm />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Evidence</h2>
        <QrList items={items} />
      </section>
    </div>
  );
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
