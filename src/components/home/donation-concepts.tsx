import { getTranslations } from "next-intl/server";
import { Linkedin } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { DonatedSearchCatcher } from "./donated-search-catcher";
import { DonatedBoardSection } from "./donated-board";

/**
 * TEMPORARY debug — four concept variants for reorganising the donation
 * area ("Komu už putovalo štěstí"): each weaves the donation offer + the
 * LinkedIn CTA (moved up from the bottom disclaimer) into the showcase, and
 * plants a "landing" clover where the drifting clovers vanish that links to
 * "Pole darovaného štěstí" (id="pole"). Rendered behind ConceptSwitcher.
 * Once a concept is picked, keep one and delete the rest + the switcher.
 */

type HomeT = Awaited<ReturnType<typeof getTranslations<"Home">>>;
const LINKEDIN_URL = "https://www.linkedin.com/in/petr-žáček-9a2473b7/";

interface ConceptProps {
  count: number;
  lastDonated: string | null;
  t: HomeT;
  nf: Intl.NumberFormat;
}

function CloverShape() {
  return (
    <g fill="#15803d">
      <circle cx={0} cy={-5} r={4} />
      <circle cx={-5} cy={0} r={4} />
      <circle cx={5} cy={0} r={4} />
      <circle cx={0} cy={5} r={4} />
      <circle cx={0} cy={0} r={2.5} fill="#0f6e34" />
    </g>
  );
}

const STATIC_CLUSTER = [
  { x: 82, y: 52, s: 1.0, o: 1.0 },
  { x: 70, y: 58, s: 0.85, o: 0.95 },
  { x: 92, y: 46, s: 0.8, o: 0.9 },
  { x: 76, y: 42, s: 0.7, o: 0.85 },
  { x: 96, y: 62, s: 0.82, o: 0.95 },
  { x: 65, y: 48, s: 0.65, o: 0.8 },
];

/** The drift animation. `poleHref` plants a pulsing "landing" clover at the
 *  right (where the drifters vanish) linking to the donated-luck field. */
function DriftSvg({ poleHref }: { poleHref?: string }) {
  const DRIFTERS = 16;
  const LOOP_S = 8;
  return (
    <div className="relative mx-auto mt-1.5 w-full max-w-2xl">
      <style>{`
        @keyframes ctyr-drift {
          0%   { transform: translate(82px, var(--y0)) rotate(0deg)  scale(0.7);  opacity: 0; }
          12%  { opacity: 0.95; }
          70%  { opacity: 0.55; }
          100% { transform: translate(540px, calc(var(--y0) - 10px)) rotate(45deg) scale(0.5); opacity: 0; }
        }
        @keyframes ctyr-land-pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.18); } }
        @media (prefers-reduced-motion: reduce) {
          .ctyr-drifter, .ctyr-land-clover { animation: none !important; }
        }
      `}</style>
      <svg
        viewBox="0 5 600 72"
        preserveAspectRatio="xMidYMid meet"
        className="h-20 w-full sm:h-24"
        aria-hidden
      >
        {STATIC_CLUSTER.map((c, i) => (
          <g
            key={`s${i}`}
            transform={`translate(${c.x} ${c.y}) scale(${c.s})`}
            opacity={c.o}
          >
            <CloverShape />
          </g>
        ))}
        {Array.from({ length: DRIFTERS }, (_, i) => {
          const yJitter = ((i * 17) % 28) - 14;
          const delay = -((i / DRIFTERS) * LOOP_S);
          return (
            <g
              key={`d${i}`}
              className="ctyr-drifter"
              style={
                {
                  animation: `ctyr-drift ${LOOP_S}s linear infinite`,
                  animationDelay: `${delay.toFixed(2)}s`,
                  transformOrigin: "center",
                  transformBox: "fill-box",
                  "--y0": `${52 + yJitter}px`,
                } as React.CSSProperties
              }
            >
              <CloverShape />
            </g>
          );
        })}
      </svg>
      {poleHref && (
        <a
          href={poleHref}
          title="Kam padají? → Pole darovaného štěstí"
          className="group absolute right-[6%] top-1/2 flex -translate-y-1/2 flex-col items-center gap-0.5 rounded-full p-1 transition hover:scale-110"
        >
          <svg
            viewBox="-11 -11 22 22"
            className="ctyr-land-clover h-8 w-8 drop-shadow"
            style={{ animation: "ctyr-land-pulse 2.4s ease-in-out infinite" }}
            aria-hidden
          >
            <CloverShape />
          </svg>
          <span className="text-[9px] font-semibold text-brand-700 opacity-70 group-hover:opacity-100">
            → pole
          </span>
        </a>
      )}
    </div>
  );
}

function CountLine({ count, lastDonated, t, nf }: ConceptProps) {
  return (
    <>
      <p className="text-base text-gray-700 sm:text-lg">
        {t("donatedPrefix")}{" "}
        <Link
          href="/sbirka?state=DONATED"
          className="relative inline-block rounded-sm transition-transform hover:scale-[1.02] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          aria-label={t("donatedAria", { count: nf.format(count) })}
        >
          <span className="text-2xl font-bold text-brand-700 hover:text-brand-800 sm:text-3xl">
            {nf.format(count)}
          </span>
        </Link>{" "}
        {t("donatedSuffix", { count })}
      </p>
      {lastDonated && (
        <p className="mt-1 text-xs text-gray-500">
          {t("donatedLast")}{" "}
          <span className="text-gray-600">{lastDonated}</span>
        </p>
      )}
    </>
  );
}

function LinkedInButton({ t }: { t: HomeT }) {
  return (
    <a
      href={LINKEDIN_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 rounded-full bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
    >
      <Linkedin className="h-4 w-4" aria-hidden />
      {t("disclaimerCta")}
    </a>
  );
}

/* ─────────────── Concept 1 — Kruh štěstí ─────────────── */
export function ConceptKruh(p: ConceptProps) {
  const { t } = p;
  return (
    <section className="text-center">
      <CountLine {...p} />
      <DriftSvg poleHref="#pole" />
      <div className="mx-auto mt-2 grid max-w-3xl gap-3 sm:grid-cols-2">
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-[15px] leading-relaxed text-gray-600">
            {t("disclaimerOffer")}
          </p>
          <LinkedInButton t={t} />
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <DonatedSearchCatcher />
        </div>
      </div>
      <p className="mt-4 text-xl font-bold text-brand-700">
        {t("disclaimerTagline")}
      </p>
    </section>
  );
}

/* ─────────── Concept 2 — Odlétají za tebou ─────────── */
export function ConceptOdletaji(p: ConceptProps) {
  const { t } = p;
  return (
    <section className="text-center">
      <CountLine {...p} />
      <div className="mx-auto mt-2 flex max-w-3xl flex-col items-center gap-3 sm:flex-row sm:justify-between">
        <div className="min-w-0 flex-1">
          <DriftSvg />
        </div>
        <div className="shrink-0 text-center">
          <LinkedInButton t={t} />
          <p className="mx-auto mt-2 max-w-[16rem] text-sm text-gray-600">
            {t("disclaimerOffer")}
          </p>
        </div>
      </div>
      <div className="mt-3">
        <DonatedSearchCatcher />
      </div>
      <p className="mt-4 flex items-center justify-center gap-3 text-xl font-bold text-brand-700">
        {t("disclaimerTagline")}
        <a
          href="#pole"
          title="Pole darovaného štěstí"
          className="text-sm font-semibold text-brand-600 hover:text-brand-800"
        >
          🍀 → pole
        </a>
      </p>
    </section>
  );
}

/* ───────────── Concept 3 — Pošli štěstí (💌) ───────────── */
export function ConceptPosli(p: ConceptProps) {
  const { t } = p;
  return (
    <section className="text-center">
      <CountLine {...p} />
      <DriftSvg poleHref="#pole" />
      <div className="relative mx-auto mt-2 max-w-xl overflow-hidden rounded-2xl border border-amber-200 bg-gradient-to-b from-amber-50/80 to-white p-6 shadow-sm">
        <div className="text-3xl" aria-hidden>
          🍀😇💌
        </div>
        <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-gray-700">
          {t("disclaimerOffer")}
        </p>
        <p className="mt-3 text-lg font-bold text-brand-700">
          {t("disclaimerTagline")}
        </p>
        <div className="mt-4 flex justify-center">
          <LinkedInButton t={t} />
        </div>
      </div>
      <div className="mt-3">
        <DonatedSearchCatcher />
      </div>
    </section>
  );
}

/* ───────────── Concept 4 — Pole hned pod tím ───────────── */
export async function ConceptPole(p: ConceptProps) {
  const { t } = p;
  return (
    <section className="text-center">
      <CountLine {...p} />
      <DriftSvg poleHref="#pole" />
      <p className="mx-auto mt-2 max-w-2xl text-[15px] leading-relaxed text-gray-600">
        {t("disclaimerOffer")}
      </p>
      <div className="mt-4 flex justify-center">
        <LinkedInButton t={t} />
      </div>
      <p className="mt-4 text-lg font-bold text-brand-700">
        {t("disclaimerTagline")}
      </p>
      <div className="mt-3">
        <DonatedSearchCatcher />
      </div>
      {/* The field pulled up right below — clovers "land" here. */}
      <DonatedBoardSection />
    </section>
  );
}
