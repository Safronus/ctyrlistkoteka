import Link from "next/link";
import { ArrowLeft, RotateCw, Target } from "lucide-react";
import { ensureAdminAuth } from "@/lib/admin/guard";
import { getHomeRotationSettings } from "@/lib/homeRotation.server";
import { HomeRotationForm } from "./settings-form";
import { prisma } from "@/lib/db";
import { readSiteSettings } from "@/lib/admin/siteSettings";
import { DistanceOriginForm, type OriginChoice } from "./distance-origin-form";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  await ensureAdminAuth();
  const settings = await getHomeRotationSettings();
  const site = await readSiteSettings();

  // Only locations with a centre can serve as a distance origin — the
  // measurement is ST_DistanceSphere from that point.
  const rows = await prisma.$queryRaw<
    Array<{ id: number; code: string; display_name: string; finds: bigint }>
  >`
    SELECT l.id, l.code, l.display_name,
           (SELECT COUNT(*) FROM finds f WHERE f.location_id = l.id) AS finds
    FROM locations l
    WHERE l.center_point IS NOT NULL
    ORDER BY l.id
  `;
  const choices: OriginChoice[] = rows.map((r) => ({
    id: r.id,
    code: r.code,
    displayName: r.display_name,
    finds: Number(r.finds),
  }));

  return (
    <div className="space-y-6">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1 text-sm text-gray-500 transition hover:text-brand-700"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Přehled
      </Link>

      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-gray-900">Nastavení</h1>
        <p className="text-sm text-gray-600">
          Věci, které se dřív měnily jen v kódu. Uložení se na veřejné
          stránce projeví ihned.
        </p>
      </header>

      <section className="max-w-2xl space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Target className="h-4 w-4 text-brand-600" aria-hidden />
          Bod, od kterého se měří vzdálenosti
        </h2>
        <DistanceOriginForm
          current={site.distanceOriginLocationId}
          choices={choices}
        />
      </section>

      <section className="max-w-2xl space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <RotateCw className="h-4 w-4 text-brand-600" aria-hidden />
          Rotace na hlavní stránce
        </h2>
        <p className="text-xs text-gray-500">
          Délky rotace tří otáčejících se prvků na hlavní stránce, v
          sekundách.
        </p>
        <HomeRotationForm initial={settings} />
      </section>
    </div>
  );
}
