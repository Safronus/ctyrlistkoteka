import { MapPin, Printer, ScanLine, Sparkles } from "lucide-react";
import {
  DROP_STATUS_COLOR,
  DROP_STATUS_LABEL,
  DROP_STATUS_ORDER,
} from "@/lib/admin/dropVocab";
import type { DropStatus } from "@/generated/prisma/enums";

/**
 * How the wave is doing, at the top of its own page.
 *
 * The counters in the header answered "how many are in each state"; this
 * answers the questions that follow — how far along the whole thing is,
 * whether anybody is finding them, and which town is carrying it. Per
 * area, because that is the unit the work actually happens in: a Saturday
 * is spent in one town, not across a wave.
 */

export interface StatsItem {
  status: DropStatus;
  areaId: number | null;
  lat: number | null;
  scans: number;
  foundAt: Date | null;
}

export interface StatsArea {
  id: number;
  name: string;
}

export function CampaignStats({
  items,
  areas,
  lastScanAt,
}: {
  items: StatsItem[];
  areas: StatsArea[];
  lastScanAt: Date | null;
}) {
  const total = items.length;
  if (total === 0) return null;

  const byStatus = new Map<DropStatus, number>();
  for (const i of items) {
    byStatus.set(i.status, (byStatus.get(i.status) ?? 0) + 1);
  }
  const placed = items.filter((i) => i.lat !== null).length;
  const printed = items.filter(
    (i) => i.status !== "PREPARED",
  ).length;
  const hidden = items.filter(
    (i) => i.status === "HIDDEN" || i.status === "FOUND",
  ).length;
  const found = items.filter((i) => i.foundAt !== null).length;
  const scans = items.reduce((s, i) => s + i.scans, 0);
  const scanned = items.filter((i) => i.scans > 0).length;

  // Scans per FOUND card, not per card in the wave: a card nobody has
  // picked up yet drags the average toward zero and says nothing about
  // how interesting the landing page is.
  const perFound = found > 0 ? scans / found : 0;

  const rows = [
    ...areas.map((a) => ({
      id: a.id as number | null,
      name: a.name,
      items: items.filter((i) => i.areaId === a.id),
    })),
    { id: null, name: "Bez oblasti", items: items.filter((i) => i.areaId === null) },
  ].filter((r) => r.items.length > 0);

  return (
    <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-900">Souhrn sady</h2>

      {/* The wave as one bar: prepared → printed → hidden → found. */}
      <div>
        <div className="flex h-3 overflow-hidden rounded-full bg-gray-100">
          {DROP_STATUS_ORDER.map((s) => {
            const n = byStatus.get(s) ?? 0;
            if (n === 0) return null;
            return (
              <div
                key={s}
                style={{
                  width: `${(n / total) * 100}%`,
                  backgroundColor: DROP_STATUS_COLOR[s],
                }}
                title={`${DROP_STATUS_LABEL[s]}: ${n}`}
              />
            );
          })}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
          {DROP_STATUS_ORDER.map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: DROP_STATUS_COLOR[s] }}
              />
              <span className="text-gray-500">{DROP_STATUS_LABEL[s]}</span>
              <strong className="font-mono tabular-nums text-gray-900">
                {byStatus.get(s) ?? 0}
              </strong>
            </span>
          ))}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          icon={<Printer className="h-3.5 w-3.5" aria-hidden />}
          label="Připraveno k vypuštění"
          value={`${printed} z ${total}`}
          note={`${pct(printed, total)} vlny je aspoň vytištěných`}
        />
        <Tile
          icon={<MapPin className="h-3.5 w-3.5" aria-hidden />}
          label="Má pozici v mapě"
          value={`${placed} z ${total}`}
          note={
            hidden > placed
              ? `${hidden - placed} schovaných bez zaznamenané pozice`
              : "všechny schované mají pozici"
          }
          tone={hidden > placed ? "warn" : undefined}
        />
        <Tile
          icon={<ScanLine className="h-3.5 w-3.5" aria-hidden />}
          label="Naskenování celkem"
          value={String(scans)}
          note={
            scanned > 0
              ? `${scanned} kusů někdo naskenoval`
              : "zatím nikdo neskenoval"
          }
        />
        <Tile
          icon={<Sparkles className="h-3.5 w-3.5" aria-hidden />}
          label="Nalezeno"
          value={`${found} z ${hidden || total}`}
          note={
            found > 0
              ? `${perFound.toFixed(1).replace(".", ",")}× sken na nalezený kus`
              : "zatím nic nenašli"
          }
        />
      </div>

      {lastScanAt && (
        <p className="text-[11px] text-gray-500">
          Poslední naskenování: {fmt.format(lastScanAt)}
        </p>
      )}

      {rows.length > 1 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-xs">
            <thead>
              <tr className="border-b border-gray-200 text-left text-[11px] uppercase tracking-wide text-gray-400">
                <th className="py-1.5 pr-3 font-medium">Oblast</th>
                <th className="py-1.5 pr-3 text-right font-medium">Kusů</th>
                <th className="py-1.5 pr-3 text-right font-medium">Schovaných</th>
                <th className="py-1.5 pr-3 text-right font-medium">S pozicí</th>
                <th className="py-1.5 pr-3 text-right font-medium">Nalezeno</th>
                <th className="py-1.5 text-right font-medium">Skenů</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const h = r.items.filter(
                  (i) => i.status === "HIDDEN" || i.status === "FOUND",
                ).length;
                return (
                  <tr key={String(r.id)} className="border-b border-gray-100">
                    <td className="py-1.5 pr-3 font-medium text-gray-900">
                      {r.name}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-gray-700">
                      {r.items.length}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-gray-700">
                      {h}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-gray-700">
                      {r.items.filter((i) => i.lat !== null).length}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-gray-700">
                      {r.items.filter((i) => i.foundAt !== null).length}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-gray-700">
                      {r.items.reduce((s, i) => s + i.scans, 0)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const fmt = new Intl.DateTimeFormat("cs-CZ", {
  day: "numeric",
  month: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function pct(n: number, of: number): string {
  return of === 0 ? "0 %" : `${Math.round((n / of) * 100)} %`;
}

function Tile({
  icon,
  label,
  value,
  note,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  note: string;
  tone?: "warn";
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-2.5">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-gray-500">
        <span className="text-gray-400">{icon}</span>
        {label}
      </p>
      <p className="mt-0.5 font-mono text-lg font-bold tabular-nums text-gray-900">
        {value}
      </p>
      <p
        className={`text-[11px] ${tone === "warn" ? "text-amber-700" : "text-gray-400"}`}
      >
        {note}
      </p>
    </div>
  );
}
