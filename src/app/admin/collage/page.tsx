import Link from "next/link";
import { ArrowLeft, Images } from "lucide-react";
import { ensureAdminAuth } from "@/lib/admin/guard";
import {
  getCollageStatus,
  listCollageBatches,
  tailCollageLog,
} from "@/lib/admin/collageRunner";
import { CollagePanel } from "./collage-panel";

/**
 * Collage workshop — build a pattern out of the collection's own crops
 * from any range of find numbers and download it.
 *
 * The generator was only ever a CLI script written for one job (the
 * 30 000 celebration). It turns out to be a tool worth keeping, so this
 * is the same script with a form in front of it. Runs land in their own
 * directory by default; replacing the frozen landing-page backgrounds is
 * a separate, explicit tick.
 */
export const dynamic = "force-dynamic";

export default async function AdminCollagePage() {
  await ensureAdminAuth();
  const [status, log, batches] = await Promise.all([
    getCollageStatus(),
    tailCollageLog(),
    listCollageBatches(),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 hover:text-gray-800"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Přehled
        </Link>
      </div>

      <header className="rounded-xl border border-gray-200 bg-white p-4">
        <h1 className="flex items-center gap-2 text-base font-semibold text-gray-900">
          <Images className="h-5 w-5 text-teal-600" aria-hidden />
          Dílna na koláže
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          Vzory poskládané z ořezů sbírky — z libovolného rozsahu čísel
          nálezů, klidně ze všech. Uloží se stranou ke stažení; ostrá pozadí
          kartiček zůstanou nedotčená, dokud to výslovně nezaškrtneš.
        </p>
      </header>

      <CollagePanel initial={{ status, log, batches }} />
    </div>
  );
}
