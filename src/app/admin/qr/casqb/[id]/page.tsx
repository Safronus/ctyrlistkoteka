import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, ExternalLink, ShieldCheck } from "lucide-react";
import { ensureAdminAuth } from "@/lib/admin/guard";
import { prisma } from "@/lib/db";
import {
  CASQB_DEFAULT_STYLE,
  parseCasqbStyle,
  renderCasqbQrSvg,
} from "@/lib/admin/casqbQr";
import {
  CASQB_HORIZONS,
  casqbCodeStats,
  type CasqbHorizon,
} from "@/lib/admin/casqbStats";
import { COLLECTION_TIME_ZONE } from "@/lib/collectionTime";
import { casqbEncodedLabel, casqbEncodedUrl } from "@/lib/admin/casqbEncoded";
import { pluralCs } from "@/lib/format";
import { Columns } from "./columns";
import { StatsActions } from "./stats-actions";

export const metadata: Metadata = {
  title: "CaSQB QR — statistiky",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const HORIZON_LABELS: Record<CasqbHorizon, string> = {
  7: "7 dní",
  30: "30 dní",
  90: "90 dní",
  365: "Rok",
  0: "Vše",
};

const WEEKDAYS = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];

const dateFmt = new Intl.DateTimeFormat("cs-CZ", {
  timeZone: COLLECTION_TIME_ZONE,
  day: "numeric",
  month: "numeric",
  year: "numeric",
});
const dateTimeFmt = new Intl.DateTimeFormat("cs-CZ", {
  timeZone: COLLECTION_TIME_ZONE,
  day: "numeric",
  month: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function dayLabel(day: string): string {
  const [, m, d] = day.split("-").map(Number) as [number, number, number];
  return `${d}. ${m}.`;
}

export default async function CasqbStatsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ h?: string | string[] }>;
}) {
  await ensureAdminAuth();
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const sp = await searchParams;
  const hRaw = Number(Array.isArray(sp.h) ? sp.h[0] : sp.h);
  const horizon: CasqbHorizon = (CASQB_HORIZONS as readonly number[]).includes(hRaw)
    ? (hRaw as CasqbHorizon)
    : 30;

  const code = await prisma.qrCode.findUnique({ where: { id } });
  if (!code || code.kind !== "casqb") notFound();
  const stats = await casqbCodeStats(id, horizon);
  if (!stats) notFound();

  const style = parseCasqbStyle(code.style) ?? CASQB_DEFAULT_STYLE;
  const url = casqbEncodedUrl(code.token);
  const thumb = renderCasqbQrSvg({ url, style, px: 64 }).replace(
    /<svg([^>]*)\swidth="\d+"\sheight="\d+"/,
    '<svg$1 width="64" height="64"',
  );
  const pct = (n: number) => `${Math.round(n)} %`;
  const perDay = stats.perDay.toLocaleString("cs-CZ", { maximumFractionDigits: 1 });
  const dayEvery = stats.byDay.length > 60 ? 14 : stats.byDay.length > 20 ? 3 : 1;

  return (
    <div className="space-y-5">
      <Link
        href="/admin/qr"
        className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> QR kódy
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div
            className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-white"
            dangerouslySetInnerHTML={{ __html: thumb }}
          />
          <div>
            <h1 className="flex flex-wrap items-center gap-2 text-lg font-semibold text-gray-900">
              {code.label}
              {code.archivedAt && (
                <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-rose-800">
                  Vyřazený
                </span>
              )}
            </h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-gray-500">
              <ExternalLink className="h-3 w-3 text-gray-400" aria-hidden />
              <span className="text-gray-700">{code.targetUrl}</span>
              <span className="text-gray-400">·</span>
              <span className="font-mono text-gray-600">{casqbEncodedLabel(code.token)}</span>
              <span className="text-gray-400">· vytvořen {dateFmt.format(code.createdAt)}</span>
              {code.archivedAt && (
                <span className="text-gray-400">· vyřazen {dateFmt.format(code.archivedAt)}</span>
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`/admin/api/qr/casqb/${code.id}/scans`}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
          >
            <Download className="h-3.5 w-3.5" aria-hidden /> CSV skenů
          </a>
          <StatsActions id={code.id} label={code.label} archived={code.archivedAt !== null} total={stats.total} />
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium text-gray-700">Horizont</span>
        <div className="inline-flex flex-wrap overflow-hidden rounded-md border border-gray-300">
          {CASQB_HORIZONS.map((h, i) => (
            <Link
              key={h}
              href={`/admin/qr/casqb/${code.id}?h=${h}`}
              aria-current={h === horizon ? "page" : undefined}
              className={`px-2.5 py-1.5 text-xs font-medium transition ${i > 0 ? "border-l border-gray-300" : ""} ${
                h === horizon ? "bg-brand-600 text-white" : "bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              {HORIZON_LABELS[h]}
            </Link>
          ))}
        </div>
        <span className="ml-auto text-[11px] text-gray-400">Časy v {COLLECTION_TIME_ZONE}</span>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Celkem" value={stats.total.toLocaleString("cs-CZ")} />
        <Tile label={`Za ${HORIZON_LABELS[horizon].toLowerCase()}`} value={stats.inHorizon.toLocaleString("cs-CZ")} sub={`${perDay} denně`} />
        <Tile label="Za 7 dní" value={stats.last7.toLocaleString("cs-CZ")} sub={stats.last30 > 0 ? `${pct((stats.last7 / stats.last30) * 100)} z posledních 30 dní` : undefined} />
        <Tile label="Nejsilnější den" value={stats.bestDay ? stats.bestDay.count.toLocaleString("cs-CZ") : "—"} sub={stats.bestDay ? dateFmt.format(new Date(`${stats.bestDay.day}T12:00:00`)) : "v horizontu nic"} />
        <Tile label="První sken" value={stats.first ? dateFmt.format(stats.first) : "—"} sub={stats.first ? dateTimeFmt.format(stats.first).split(" ").pop() : undefined} />
        <Tile label="Poslední sken" value={stats.last ? dateFmt.format(stats.last) : "—"} sub={stats.last ? dateTimeFmt.format(stats.last).split(" ").pop() : undefined} />
      </div>

      {code.archivedAt && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Po vyřazení přišlo ještě <strong>{stats.afterRetire.toLocaleString("cs-CZ")}</strong>{" "}
          {pluralCs(stats.afterRetire, ["sken", "skeny", "skenů"])} — kód dál
          přesměrovává, takže tohle je, jak moc ještě žije v oběhu.
        </p>
      )}

      <Card
        title="Skeny po dnech"
        note={`${HORIZON_LABELS[horizon].toLowerCase()} · ${stats.byDay.length} ${pluralCs(stats.byDay.length, ["den", "dny", "dní"])}`}
      >
        <Columns
          values={stats.byDay.map((d) => d.count)}
          labels={stats.byDay.map((d) => dayLabel(d.day))}
          titles={stats.byDay.map((d) => `${dateFmt.format(new Date(`${d.day}T12:00:00`))}: ${d.count.toLocaleString("cs-CZ")} skenů`)}
          width={1040}
          height={200}
          every={dayEvery}
        />
      </Card>
      <div className="grid gap-3 lg:grid-cols-[3fr_2fr]">
        <Card title="Denní doba" note="kdy se skenuje, součet za horizont">
          <Columns
            values={stats.byHour}
            labels={stats.byHour.map((_, h) => `${h}`)}
            titles={stats.byHour.map((v, h) => `${h}:00–${h}:59: ${v.toLocaleString("cs-CZ")} skenů`)}
            width={600}
            height={180}
            every={3}
          />
        </Card>
        <Card title="Den v týdnu" note="součet za horizont">
          <Columns
            values={stats.byWeekday}
            labels={WEEKDAYS}
            titles={stats.byWeekday.map((v, i) => `${WEEKDAYS[i]}: ${v.toLocaleString("cs-CZ")} skenů`)}
            width={400}
            height={180}
          />
        </Card>
      </div>

      <p className="flex items-start gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
        <span>
          Ukládá se <strong>jen okamžik naskenování</strong>. Žádná IP adresa, zařízení,
          jazyk ani poloha — a proto ani „unikátní návštěvníci“: bez otisku zařízení
          se nedají poznat, a otisk by už byl osobní údaj. Opakované skeny téhož
          telefonu do 10 s se počítají jednou.
        </span>
      </p>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3.5 py-3">
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className="text-xl font-semibold tabular-nums text-gray-900">{value}</p>
      {sub && <p className="text-[11px] text-gray-400">{sub}</p>}
    </div>
  );
}

function Card({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
        {note && <span className="text-[11px] text-gray-400">{note}</span>}
      </div>
      {children}
    </section>
  );
}
