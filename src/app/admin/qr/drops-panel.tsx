import Link from "next/link";
import { ArrowRight, Globe2, MapPin, Plus, ScanLine } from "lucide-react";
import { prisma } from "@/lib/db";
import { DropStatus } from "@/generated/prisma/client";
import { DROP_STATUS_LABEL, DROP_STATUS_ORDER } from "@/lib/admin/drops";
import { NewCampaignButton } from "./drops-new-campaign";

/**
 * The "Darování ve světě" tab: a directory, not a workbench.
 *
 * Managing one wave means a map, a hundred QR previews and a pile of
 * texts — far too much to keep in a tab beside two other QR generators.
 * The tab lists the waves with their headline numbers and hands off to
 * `/admin/qr/darovani/<id>`, which is also a URL you can bookmark or send
 * to yourself while standing in a park.
 */
export async function DropsPanel() {
  const campaigns = await prisma.dropCampaign.findMany({
    orderBy: [{ archivedAt: "asc" }, { id: "desc" }],
    include: {
      areas: { select: { id: true, name: true } },
      items: { select: { status: true, lat: true } },
      _count: { select: { items: true } },
    },
  });

  return (
    <section className="space-y-4 rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-xs text-gray-600">
          Čtyřlístky zalaminované na kartičku a schované v reálném světě. Každý
          kus má vlastní náhodnou adresu{" "}
          <span className="font-mono">/d/&lt;uuid&gt;</span>, která po
          naskenování ukáže vzkaz a nabídne detail nálezu — nikam nepřesměrovává
          a nikdy neprozradí, kde je kartička schovaná.
        </p>
        <NewCampaignButton />
      </div>

      {campaigns.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          Zatím žádná sada. Založ první — třeba „Vlna 2026“.
        </p>
      ) : (
        <ul className="space-y-3">
          {campaigns.map((c) => {
            const byStatus = new Map<DropStatus, number>();
            let withGps = 0;
            for (const i of c.items) {
              byStatus.set(i.status, (byStatus.get(i.status) ?? 0) + 1);
              if (i.lat !== null) withGps += 1;
            }
            return (
              <li
                key={c.id}
                className="rounded-lg border border-gray-200 bg-white p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                      <Globe2
                        className="h-4 w-4 text-emerald-600"
                        aria-hidden
                      />
                      {c.name}
                      {c.archivedAt && (
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-600">
                          archivovaná
                        </span>
                      )}
                    </h3>
                    {c.note && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">
                        {c.note}
                      </p>
                    )}
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3" aria-hidden />
                        {c.areas.length === 0
                          ? "bez oblastí"
                          : c.areas.map((a) => a.name).join(" · ")}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <ScanLine className="h-3 w-3" aria-hidden />
                        {withGps} / {c._count.items} má pozici
                      </span>
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-3">
                    {DROP_STATUS_ORDER.map((s) => (
                      <div key={s} className="text-center">
                        <p className="font-mono text-lg font-bold tabular-nums text-gray-900">
                          {byStatus.get(s) ?? 0}
                        </p>
                        <p className="text-[10px] uppercase tracking-wide text-gray-400">
                          {DROP_STATUS_LABEL[s]}
                        </p>
                      </div>
                    ))}
                    <Link
                      href={`/admin/qr/darovani/${c.id}`}
                      className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900 transition hover:bg-emerald-100"
                    >
                      Spravovat
                      <ArrowRight className="h-4 w-4" aria-hidden />
                    </Link>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="flex items-center gap-1.5 text-[11px] text-gray-400">
        <Plus className="h-3 w-3" aria-hidden />
        Další vlny se zakládají jako nové sady — model počítá s tím, že jich
        bude víc a každá může mít jiná města.
      </p>
    </section>
  );
}
