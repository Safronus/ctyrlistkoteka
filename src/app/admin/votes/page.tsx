import Link from "next/link";
import { ArrowLeft, Hash, Trash2, Trophy } from "lucide-react";
import { ensureAdminAuth } from "@/lib/admin/guard";
import { prisma } from "@/lib/db";
import { ResetAllVotesButton } from "./reset-all-button";
import {
  deleteOneVote,
  deleteVotesByFingerprint,
  deleteVotesByVoterUuid,
} from "./actions";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function pickString(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

const PAGE_SIZE = 50;

export default async function AdminVotesPage({ searchParams }: PageProps) {
  await ensureAdminAuth();
  const sp = await searchParams;

  // Filters — all optional, all validated before reaching Prisma so a
  // tampered query string can't inject SQL via raw $queryRaw (we use
  // typed Prisma here regardless, but defence in depth is cheap).
  const findIdRaw = pickString(sp.findId);
  const fingerprintRaw = pickString(sp.fp);
  const voterRaw = pickString(sp.voter);

  const findId =
    findIdRaw && /^[1-9]\d{0,8}$/.test(findIdRaw) ? Number(findIdRaw) : undefined;
  const fingerprint =
    fingerprintRaw && /^[0-9a-f]{40}$/.test(fingerprintRaw)
      ? fingerprintRaw
      : undefined;
  const voterUuid =
    voterRaw &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      voterRaw,
    )
      ? voterRaw
      : undefined;

  const where = {
    ...(findId !== undefined && { findId }),
    ...(fingerprint !== undefined && { fingerprint }),
    ...(voterUuid !== undefined && { voterUuid }),
  };

  const [totalVotes, totalFiltered, votes, topFinds] = await Promise.all([
    prisma.findVote.count(),
    prisma.findVote.count({ where }),
    prisma.findVote.findMany({
      where,
      orderBy: { votedAt: "desc" },
      take: PAGE_SIZE,
    }),
    // Bird's-eye summary on the table — top 5 finds by current vote
    // count, so the admin sees ballot stuffing patterns at a glance
    // even before scrolling the timeline.
    prisma.find.findMany({
      where: { voteCount: { gt: 0 } },
      orderBy: { voteCount: "desc" },
      take: 5,
      select: { id: true, voteCount: true },
    }),
  ]);

  const hasFilter = findId !== undefined || fingerprint !== undefined || voterUuid !== undefined;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 hover:text-gray-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Admin
        </Link>
        <span aria-hidden>/</span>
        <span className="text-gray-900">Hlasování</span>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
            <Trophy className="h-6 w-6 text-amber-500" aria-hidden />
            Hlasování
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Celkem hlasů: <strong>{totalVotes.toLocaleString("cs-CZ")}</strong>
            {hasFilter && (
              <>
                {" — "}filtrováno: <strong>{totalFiltered}</strong>
              </>
            )}
            {" · "}zobrazeno posledních {Math.min(votes.length, PAGE_SIZE)}.
          </p>
        </div>
        <ResetAllVotesButton totalVotes={totalVotes} />
      </header>

      {topFinds.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-900">
            Top 5 podle počtu hlasů
          </h2>
          <ul className="flex flex-wrap gap-2 text-sm">
            {topFinds.map((f, i) => (
              <li
                key={f.id}
                className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-2 py-1"
              >
                <span className="font-bold text-amber-700">#{i + 1}</span>
                <Link
                  href={`/admin/votes?findId=${f.id}`}
                  className="font-mono text-gray-700 hover:underline"
                >
                  find #{f.id}
                </Link>
                <span className="font-mono tabular-nums text-amber-700">
                  {f.voteCount}×
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <form
        action="/admin/votes"
        method="get"
        className="flex flex-wrap items-end gap-2 rounded-xl border border-gray-200 bg-white p-3"
      >
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-gray-500">Find ID</span>
          <input
            type="number"
            name="findId"
            min={1}
            defaultValue={findId ?? ""}
            placeholder="např. 18222"
            className="w-32 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-gray-500">Fingerprint (sha1)</span>
          <input
            type="text"
            name="fp"
            defaultValue={fingerprint ?? ""}
            placeholder="40 hex chars"
            pattern="[0-9a-f]{40}"
            className="w-72 rounded-md border border-gray-300 bg-white px-2 py-1 font-mono text-xs"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-gray-500">Voter UUID</span>
          <input
            type="text"
            name="voter"
            defaultValue={voterUuid ?? ""}
            placeholder="uuid"
            className="w-72 rounded-md border border-gray-300 bg-white px-2 py-1 font-mono text-xs"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700"
        >
          Filtrovat
        </button>
        {hasFilter && (
          <Link
            href="/admin/votes"
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            Vyčistit
          </Link>
        )}
      </form>

      {votes.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-sm text-gray-500">
          {hasFilter
            ? "Žádné hlasy neodpovídají filtru."
            : "Zatím nebyly zaznamenány žádné hlasy."}
        </p>
      ) : (
        <ul className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white">
          {votes.map((v) => (
            <li
              key={`${v.findId}-${v.voterUuid}`}
              className="flex flex-wrap items-center gap-3 px-3 py-2 text-xs"
            >
              <span className="shrink-0 font-mono tabular-nums text-gray-500">
                {new Date(v.votedAt).toLocaleString("cs-CZ", {
                  timeZone: "Europe/Prague",
                })}
              </span>
              <Link
                href={`/sbirka/${v.findId}`}
                target="_blank"
                className="shrink-0 inline-flex items-center gap-1 rounded bg-brand-100 px-2 py-0.5 font-mono font-semibold text-brand-800 hover:bg-brand-200"
              >
                <Hash className="h-3 w-3" aria-hidden />
                {v.findId}
              </Link>
              <Link
                href={`/admin/votes?voter=${encodeURIComponent(v.voterUuid)}`}
                title="Filtrovat podle UUID"
                className="min-w-0 max-w-[12rem] truncate rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] text-gray-700 hover:bg-gray-200"
              >
                {v.voterUuid}
              </Link>
              <Link
                href={`/admin/votes?fp=${encodeURIComponent(v.fingerprint)}`}
                title="Filtrovat podle fingerprintu"
                className="min-w-0 max-w-[10rem] truncate rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] text-amber-900 hover:bg-amber-200"
              >
                fp:{v.fingerprint.slice(0, 12)}…
              </Link>
              <span
                className="min-w-0 max-w-[10rem] truncate rounded bg-gray-50 px-1.5 py-0.5 font-mono text-[10px] text-gray-500"
                title={`IP hash ${v.ipHash}`}
              >
                ip:{v.ipHash.slice(0, 12)}…
              </span>
              {v.userAgent && (
                <span
                  className="min-w-0 flex-1 truncate text-gray-500"
                  title={v.userAgent}
                >
                  {v.userAgent}
                </span>
              )}
              <div className="ml-auto flex shrink-0 items-center gap-1">
                {/* Three scoped delete buttons — single row / by
                 *  fingerprint / by voter UUID. Each posts its own
                 *  server action so the operator picks the blast
                 *  radius explicitly. */}
                <form action={deleteOneVote}>
                  <input type="hidden" name="findId" value={v.findId} />
                  <input type="hidden" name="voterUuid" value={v.voterUuid} />
                  <button
                    type="submit"
                    title="Smazat tento jeden hlas"
                    className="inline-flex items-center gap-1 rounded border border-red-200 bg-white px-1.5 py-0.5 font-medium text-red-700 hover:border-red-300 hover:bg-red-50"
                  >
                    <Trash2 className="h-3 w-3" aria-hidden />
                    1×
                  </button>
                </form>
                <form action={deleteVotesByFingerprint}>
                  <input
                    type="hidden"
                    name="fingerprint"
                    value={v.fingerprint}
                  />
                  <button
                    type="submit"
                    title="Smazat všechny hlasy s tímto fingerprintem"
                    className="inline-flex items-center gap-1 rounded border border-red-200 bg-white px-1.5 py-0.5 font-medium text-red-700 hover:border-red-300 hover:bg-red-50"
                  >
                    <Trash2 className="h-3 w-3" aria-hidden />
                    fp
                  </button>
                </form>
                <form action={deleteVotesByVoterUuid}>
                  <input type="hidden" name="voterUuid" value={v.voterUuid} />
                  <button
                    type="submit"
                    title="Smazat všechny hlasy z tohoto UUID"
                    className="inline-flex items-center gap-1 rounded border border-red-200 bg-white px-1.5 py-0.5 font-medium text-red-700 hover:border-red-300 hover:bg-red-50"
                  >
                    <Trash2 className="h-3 w-3" aria-hidden />
                    uuid
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
