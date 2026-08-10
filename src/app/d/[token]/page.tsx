import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { ArrowRight, Home, Sparkles } from "lucide-react";
import { prisma } from "@/lib/db";
import { registerDropScan } from "@/lib/dropScan";
import { resolveDropText, type DropLang } from "@/lib/dropText";
import {
  collageFit,
  collageUrl,
  pickCollageVariant,
  type CollageMode,
  type CollageVariant,
} from "@/lib/collage";

/**
 * Landing page of one in-the-wild card (`/d/<uuid>`).
 *
 * Reached only by scanning the QR printed on a laminated clover left
 * somewhere in a town. It is deliberately unreachable from the site: not
 * linked, `noindex`, disallowed in robots.txt and asserted out of the
 * sitemap (src/app/sitemap.test.ts). It also NEVER shows where the card
 * was hidden — that would turn a chance encounter into a shopping list.
 *
 * No auto-redirect: the finder gets the campaign's message first and
 * chooses whether to open the clover's own page or the homepage.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

/** Czech unless the browser clearly prefers English; `?lang=` wins so the
 *  in-page switch works without a locale-prefixed route. */
async function pickLang(explicit: string | undefined): Promise<DropLang> {
  if (explicit === "en" || explicit === "cs") return explicit;
  const accept = (await headers()).get("accept-language") ?? "";
  const first = accept.split(",")[0]?.trim().toLowerCase() ?? "";
  return first.startsWith("en") ? "en" : "cs";
}

export default async function DropLandingPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const [{ token }, { lang: langParam }] = await Promise.all([
    params,
    searchParams,
  ]);

  // Bounded shape before touching the DB — the path is public.
  if (!/^[A-Za-z0-9-]{8,64}$/.test(token)) notFound();

  const item = await prisma.dropItem.findUnique({
    where: { token },
    include: { campaign: true },
  });
  if (!item) notFound();

  await registerDropScan(item.id, { paused: item.campaign.scansPaused });

  // "3. ze 111" — where this card sits in its wave. Ordered by find
  // number, which is the order the wave was assembled in and the only one
  // that stays put; a position derived from anything editable would
  // change under a card already in somebody's pocket.
  const [position, total] = await Promise.all([
    prisma.dropItem.count({
      where: { campaignId: item.campaignId, findId: { lte: item.findId } },
    }),
    prisma.dropItem.count({ where: { campaignId: item.campaignId } }),
  ]);

  const lang = await pickLang(langParam);
  const t = resolveDropText(item, item.campaign, lang);
  const other: DropLang = lang === "cs" ? "en" : "cs";

  // The collage behind the page. Chosen here rather than in CSS because
  // three of the five modes need to know which card this is. If the wave
  // asks for a collage that hasn't been generated yet, the <div> simply
  // has no image to paint and the page looks exactly as it did before —
  // no check, no cost, no broken layout.
  const bgVariant = pickCollageVariant({
    mode: item.campaign.bgMode as CollageMode,
    fixed: item.campaign.bgVariant as CollageVariant,
    findId: item.findId,
    // The clock and the dice are the point of two of the modes, and this
    // route is `force-dynamic`, so it renders once per request and there
    // is no re-render for them to disagree with. `pickCollageVariant`
    // itself stays pure — it takes these as arguments precisely so it can
    // be tested without either.
    // eslint-disable-next-line react-hooks/purity
    dayIndex: Math.floor(Date.now() / 86_400_000),
    // eslint-disable-next-line react-hooks/purity
    roll: Math.random(),
  });
  const bg = bgVariant ? collageUrl(bgVariant) : null;
  const bgSize = bgVariant ? collageFit(bgVariant) : "cover";
  const bgOpacity = Math.min(100, Math.max(0, item.campaign.bgOpacity)) / 100;

  const labels =
    lang === "en"
      ? {
          openFind: "Open this clover",
          home: "Whole collection",
          hintLead: "There are more of these hidden around.",
          hintTail: "Each one leaves a clue on its own page.",
          switch: "Česky",
          ordinal: `No. ${position} of ${total} in this batch`,
        }
      : {
          openFind: "Otevřít tenhle čtyřlístek",
          home: "Celá sbírka",
          hintLead: "Schovaných je jich víc.",
          hintTail: "Ke každému je nápověda na jeho vlastní stránce.",
          switch: "English",
          ordinal: `${position}. ze ${total} v této sadě`,
        };

  return (
    <div className="relative min-h-screen">
      {bg && (
        <>
          {/* ONE layer, behind everything — it is a background, and a
              background is what the wave asked for. It used to be drawn
              twice (whole here, cropped again in a band on top), which on
              a wide screen showed both copies at once.

              Shapes are `contain` so the whole clover is there; textures
              `cover` so the carpet fills. Decorative: aria-hidden, no
              alt, and `fixed` so it doesn't scroll with the card. */}
          <div
            aria-hidden
            className="pointer-events-none fixed inset-0 z-0 bg-center bg-no-repeat"
            style={{
              backgroundImage: `url('${bg}')`,
              backgroundSize: bgSize,
              opacity: bgOpacity,
            }}
          />
        </>
      )}
      <main className="relative z-10 mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-5 py-12">
      <div className="rounded-2xl border border-brand-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-center text-5xl" aria-hidden>
          🍀
        </p>
        <h1 className="mt-4 text-balance text-center text-2xl font-bold text-brand-800 sm:text-3xl">
          {t.heading}
        </h1>

        {/* Which clover this is, and which of the batch. The find number
            is public anyway — it is printed on the card and the button
            below opens that very page — and "3. ze 111" is the bit that
            makes a single find feel like part of something. */}
        <p className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-xs text-gray-500">
          <span className="rounded-full bg-brand-50 px-2.5 py-1 font-semibold text-brand-800">
            🍀 #{item.findId}
          </span>
          <span className="rounded-full bg-gray-100 px-2.5 py-1 font-semibold tabular-nums text-gray-600">
            {labels.ordinal}
          </span>
        </p>

        <div className="mt-5 space-y-3 text-pretty text-center text-gray-700">
          {t.body.split(/\n{2,}/).map((para, i) => (
            <p key={i} className="whitespace-pre-line leading-relaxed">
              {para}
            </p>
          ))}
        </div>

        {t.bonus && (
          // The bonus block is deliberately a distinct card rather than
          // another paragraph: it is the "something extra" for whoever
          // actually stood there and scanned, so it should not read as a
          // continuation of the campaign's standard message.
          <div className="mt-6 rounded-xl border border-brand-200 bg-brand-50/70 p-4">
            <p className="flex items-center justify-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand-700">
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              Bonus
            </p>
            <div className="mt-2 space-y-2 text-center text-sm text-gray-700">
              {t.bonus.split(/\n{2,}/).map((para, i) => (
                <p key={i} className="whitespace-pre-line leading-relaxed">
                  {para}
                </p>
              ))}
            </div>
          </div>
        )}

        <div className="mt-7 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link
            href={`/sbirka/${item.findId}`}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            {labels.openFind}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-5 py-3 text-sm font-semibold text-gray-700 transition hover:border-brand-300 hover:text-brand-800"
          >
            <Home className="h-4 w-4" aria-hidden />
            {labels.home}
          </Link>
        </div>

        {/* Only when the operator published hints — otherwise saying
            "there are more" would be a tease with nothing behind it. */}
        {item.hintPublished && (
          <p className="mt-6 text-center text-xs text-gray-500">
            {labels.hintLead} {labels.hintTail}
          </p>
        )}

        <p className="mt-6 text-center">
          <Link
            href={`/d/${token}?lang=${other}`}
            className="text-xs text-gray-400 underline-offset-2 hover:text-gray-600 hover:underline"
          >
            {labels.switch}
          </Link>
        </p>
      </div>
      </main>
    </div>
  );
}
