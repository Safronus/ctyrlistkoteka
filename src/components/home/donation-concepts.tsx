import { getTranslations } from "next-intl/server";
import { Linkedin } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { DonatedSearchCatcher } from "./donated-search-catcher";

/**
 * TEMPORARY debug — variant 3 ("Pošli štěstí") was chosen; these are richer
 * clover/meadow visualisations that house the donation offer + LinkedIn CTA.
 * The count line + drift animation (with the "landing" clover → #pole) stay
 * on top. Behind ConceptSwitcher; keep the winner + delete the rest later.
 */

type HomeT = Awaited<ReturnType<typeof getTranslations<"Home">>>;
const LINKEDIN_URL = "https://www.linkedin.com/in/petr-žáček-9a2473b7/";

interface ConceptProps {
  count: number;
  lastDonated: string | null;
  t: HomeT;
  nf: Intl.NumberFormat;
}

/* ── shared: the swarm SVG glyph ── */
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
      className="inline-flex items-center gap-2 rounded-full bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md transition hover:bg-brand-700 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
    >
      <Linkedin className="h-4 w-4" aria-hidden />
      {t("disclaimerCta")}
    </a>
  );
}

/** A lush four-leaf clover glyph — rounded gradient leaves + a curved stem.
 *  Used big (backdrop) and small (meadow). */
function BigClover({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 236" className={className} aria-hidden>
      <defs>
        <radialGradient id="ctyr-leaf" cx="46%" cy="34%" r="70%">
          <stop offset="0%" stopColor="#bbf7d0" />
          <stop offset="45%" stopColor="#4ade80" />
          <stop offset="100%" stopColor="#15803d" />
        </radialGradient>
      </defs>
      {/* stem */}
      <path
        d="M100 132 q -4 52 -26 78"
        stroke="#15803d"
        strokeWidth="6"
        fill="none"
        strokeLinecap="round"
      />
      <g fill="url(#ctyr-leaf)" stroke="#16a34a" strokeWidth="1.5">
        <ellipse cx="70" cy="64" rx="38" ry="46" transform="rotate(-45 70 64)" />
        <ellipse cx="130" cy="64" rx="38" ry="46" transform="rotate(45 130 64)" />
        <ellipse cx="70" cy="122" rx="38" ry="46" transform="rotate(45 70 122)" />
        <ellipse cx="130" cy="122" rx="38" ry="46" transform="rotate(-45 130 122)" />
      </g>
      {/* soft leaf highlights */}
      <g fill="#ffffff" opacity="0.28">
        <ellipse cx="60" cy="50" rx="10" ry="15" transform="rotate(-45 60 50)" />
        <ellipse cx="140" cy="50" rx="10" ry="15" transform="rotate(45 140 50)" />
      </g>
      <circle cx="100" cy="93" r="11" fill="#166534" />
    </svg>
  );
}

/* ─────────── Concept 3 (base) — the plain letter card ─────────── */
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

/* ───────── A — V srdci čtyřlístku (offer inside a big clover) ───────── */
export function ConceptCloverHeart(p: ConceptProps) {
  const { t } = p;
  return (
    <section className="text-center">
      <CountLine {...p} />
      <DriftSvg poleHref="#pole" />
      <div className="relative mx-auto mt-4 flex min-h-[19rem] max-w-lg items-center justify-center px-2 sm:min-h-[21rem]">
        <BigClover className="absolute left-1/2 top-0 h-full w-auto -translate-x-1/2 drop-shadow-[0_10px_24px_rgba(21,128,61,0.25)]" />
        {/* content nestled in the clover's heart */}
        <div className="relative z-10 mx-6 mt-[-2rem] max-w-[19rem] rounded-2xl bg-white/85 px-5 py-4 shadow-lg ring-1 ring-emerald-100 backdrop-blur-sm">
          <div className="text-2xl" aria-hidden>
            💌
          </div>
          <p className="mt-1 text-sm leading-relaxed text-gray-700">
            {t("disclaimerOffer")}
          </p>
          <p className="mt-2 text-base font-bold text-brand-700">
            {t("disclaimerTagline")}
          </p>
          <div className="mt-3 flex justify-center">
            <LinkedInButton t={t} />
          </div>
        </div>
      </div>
      <div className="mt-3">
        <DonatedSearchCatcher />
      </div>
    </section>
  );
}

/* ───────── B — Louka štěstí (a meadow / field of clovers) ───────── */
const MEADOW = [
  { l: "5%", b: "6%", size: 30, op: 0.55 },
  { l: "13%", b: "16%", size: 20, op: 0.4 },
  { l: "21%", b: "4%", size: 26, op: 0.5 },
  { l: "30%", b: "12%", size: 16, op: 0.32 },
  { l: "40%", b: "5%", size: 22, op: 0.45 },
  { l: "50%", b: "14%", size: 15, op: 0.3 },
  { l: "60%", b: "6%", size: 24, op: 0.48 },
  { l: "69%", b: "13%", size: 18, op: 0.36 },
  { l: "78%", b: "4%", size: 28, op: 0.52 },
  { l: "87%", b: "15%", size: 19, op: 0.38 },
  { l: "94%", b: "7%", size: 23, op: 0.44 },
  { l: "9%", b: "70%", size: 14, op: 0.22 },
  { l: "89%", b: "66%", size: 16, op: 0.24 },
  { l: "46%", b: "78%", size: 12, op: 0.18 },
];

function MeadowClovers() {
  return (
    <>
      <style>{`
        @keyframes ctyr-sway { 0%,100% { transform: rotate(-7deg); } 50% { transform: rotate(7deg); } }
        @media (prefers-reduced-motion: reduce) { .ctyr-sway { animation: none !important; } }
      `}</style>
      {MEADOW.map((m, i) => (
        <span
          key={i}
          aria-hidden
          className="ctyr-sway pointer-events-none absolute"
          style={{
            left: m.l,
            bottom: m.b,
            opacity: m.op,
            transformOrigin: "bottom center",
            animation: `ctyr-sway ${3.5 + (i % 4) * 0.7}s ease-in-out ${-(i % 5) * 0.6}s infinite`,
          }}
        >
          <svg
            viewBox="0 0 100 100"
            width={m.size}
            height={m.size}
            className="block"
            aria-hidden
          >
            <g fill="#3f9142">
              <ellipse cx="35" cy="35" rx="17" ry="21" transform="rotate(-45 35 35)" />
              <ellipse cx="65" cy="35" rx="17" ry="21" transform="rotate(45 65 35)" />
              <ellipse cx="35" cy="65" rx="17" ry="21" transform="rotate(45 35 65)" />
              <ellipse cx="65" cy="65" rx="17" ry="21" transform="rotate(-45 65 65)" />
              <circle cx="50" cy="50" r="6" fill="#166534" />
            </g>
          </svg>
        </span>
      ))}
    </>
  );
}

export function ConceptMeadow(p: ConceptProps) {
  const { t } = p;
  return (
    <section className="text-center">
      <CountLine {...p} />
      <DriftSvg poleHref="#pole" />
      <div className="relative mx-auto mt-4 max-w-2xl overflow-hidden rounded-[2rem] border border-emerald-200 bg-gradient-to-b from-emerald-50 via-green-50 to-emerald-100/70 px-6 pb-10 pt-8 shadow-sm">
        <MeadowClovers />
        <div className="relative z-10 mx-auto max-w-md">
          <div className="text-2xl" aria-hidden>
            🍀😇💌
          </div>
          <p className="mt-2 text-[15px] leading-relaxed text-gray-700">
            {t("disclaimerOffer")}
          </p>
          <p className="mt-3 text-lg font-bold text-brand-700">
            {t("disclaimerTagline")}
          </p>
          <div className="mt-4 flex justify-center">
            <LinkedInButton t={t} />
          </div>
        </div>
      </div>
      <div className="mt-3">
        <DonatedSearchCatcher />
      </div>
    </section>
  );
}
