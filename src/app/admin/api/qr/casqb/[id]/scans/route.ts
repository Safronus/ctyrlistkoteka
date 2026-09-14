import { NextResponse, type NextRequest } from "next/server";
import { getAdminSession, isAuthenticated, touchSession } from "@/lib/admin/session";
import { casqbScanTimestamps } from "@/lib/admin/casqbStats";
import { COLLECTION_TIME_ZONE } from "@/lib/collectionTime";
import { prisma } from "@/lib/db";

/**
 * CSV of one CaSQB code's scans — one row per scan, one column: the
 * moment, in the collection's zone. That is the whole record; there is
 * nothing else to export. Under /admin/api so the nginx cloak covers it
 * (docs: /api/admin/* is outside the mask), and 404 — never 401 — when
 * unauthenticated, like the rest of the admin surface.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await getAdminSession();
  if (!isAuthenticated(session)) {
    return new NextResponse("Not found", { status: 404 });
  }
  await touchSession();
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    return new NextResponse("Not found", { status: 404 });
  }
  const code = await prisma.qrCode.findUnique({
    where: { id },
    select: { kind: true, token: true, archivedAt: true },
  });
  if (!code || code.kind !== "casqb") {
    return new NextResponse("Not found", { status: 404 });
  }
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: COLLECTION_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const stamps = await casqbScanTimestamps(id);
  const lines = ["scanned_at;after_retire"];
  for (const d of stamps) {
    const after = code.archivedAt !== null && d > code.archivedAt ? "1" : "0";
    lines.push(`${fmt.format(d)};${after}`);
  }
  return new NextResponse(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="casqb-qr-${code.token}-skeny.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
