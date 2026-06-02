import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ensureAdminAuth } from "@/lib/admin/guard";
import { getHomeRotationSettings } from "@/lib/homeRotation.server";
import { HomeRotationForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  await ensureAdminAuth();
  const settings = await getHomeRotationSettings();

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
        <h1 className="text-2xl font-bold text-gray-900">
          Rotace na hlavní stránce
        </h1>
        <p className="text-sm text-gray-600">
          Délky rotace tří otáčejících se prvků na hlavní stránce, v
          sekundách. Uložení se na veřejné stránce projeví ihned.
        </p>
      </header>

      <HomeRotationForm initial={settings} />
    </div>
  );
}
