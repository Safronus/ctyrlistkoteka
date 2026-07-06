import { getTranslations } from "next-intl/server";
import { Linkedin } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { DonatedSearchCatcher } from "./donated-search-catcher";

/**
 * The "give a clover away" area on the home page, top-to-bottom:
 *   1. the donation offer + LinkedIn CTA over a flood of swaying clovers,
 *   2. the drifting clovers that fly off and "land" in the field
 *      (the landing clover links to #pole — Pole darovaného štěstí),
 *   3. the running total ("Komu už putovalo štěstí" + count),
 *   4. the recipient's search ("Dostal jsi čtyřlístek?" — find it by id).
 */

type HomeT = Awaited<ReturnType<typeof getTranslations<"Home">>>;
const LINKEDIN_URL = "https://www.linkedin.com/in/petr-žáček-9a2473b7/";

interface Props {
  count: number;
  lastDonated: string | null;
  t: HomeT;
  nf: Intl.NumberFormat;
}

/* ── swarm glyph for the drift animation ── */
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

/** The drift animation with a pulsing "landing" clover at the vanishing
 *  point linking to the donated-luck field (#pole). */
function DriftSvg() {
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
      <a
        href="#pole"
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
    </div>
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

/* ── the flood: clovers along the edges + a bottom "grass" row, thinning to
 *    very faint behind the centred text so it stays readable. Deterministic
 *    (SSR-stable). ── */
const FLOOD: ReadonlyArray<{ l: string; t: string; size: number; op: number }> =
  [
    { l: "3%", t: "1%", size: 28, op: 0.5 },
    { l: "15%", t: "8%", size: 18, op: 0.36 },
    { l: "28%", t: "2%", size: 23, op: 0.44 },
    { l: "42%", t: "7%", size: 15, op: 0.26 },
    { l: "57%", t: "1%", size: 21, op: 0.42 },
    { l: "70%", t: "8%", size: 17, op: 0.32 },
    { l: "84%", t: "2%", size: 26, op: 0.48 },
    { l: "95%", t: "9%", size: 16, op: 0.3 },
    { l: "1%", t: "28%", size: 21, op: 0.38 },
    { l: "7%", t: "50%", size: 16, op: 0.28 },
    { l: "2%", t: "70%", size: 25, op: 0.46 },
    { l: "11%", t: "86%", size: 18, op: 0.34 },
    { l: "97%", t: "30%", size: 21, op: 0.38 },
    { l: "91%", t: "52%", size: 16, op: 0.28 },
    { l: "98%", t: "72%", size: 23, op: 0.44 },
    { l: "88%", t: "88%", size: 18, op: 0.34 },
    { l: "6%", t: "95%", size: 27, op: 0.52 },
    { l: "18%", t: "90%", size: 19, op: 0.4 },
    { l: "30%", t: "96%", size: 23, op: 0.46 },
    { l: "42%", t: "91%", size: 16, op: 0.32 },
    { l: "52%", t: "97%", size: 21, op: 0.44 },
    { l: "63%", t: "90%", size: 18, op: 0.38 },
    { l: "74%", t: "96%", size: 25, op: 0.48 },
    { l: "86%", t: "92%", size: 17, op: 0.34 },
    { l: "95%", t: "97%", size: 20, op: 0.42 },
    { l: "24%", t: "34%", size: 14, op: 0.13 },
    { l: "68%", t: "30%", size: 13, op: 0.12 },
    { l: "33%", t: "58%", size: 15, op: 0.15 },
    { l: "60%", t: "62%", size: 13, op: 0.13 },
    { l: "48%", t: "44%", size: 12, op: 0.1 },
    { l: "17%", t: "62%", size: 12, op: 0.12 },
    { l: "80%", t: "60%", size: 14, op: 0.13 },
  ];

const SHADES = ["#3f9142", "#4d9748", "#2f8038", "#57a457"];

function FloodClover({ size, shade }: { size: number; shade: string }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className="block" aria-hidden>
      <g fill={shade}>
        <ellipse cx="35" cy="35" rx="17" ry="21" transform="rotate(-45 35 35)" />
        <ellipse cx="65" cy="35" rx="17" ry="21" transform="rotate(45 65 35)" />
        <ellipse cx="35" cy="65" rx="17" ry="21" transform="rotate(45 35 65)" />
        <ellipse cx="65" cy="65" rx="17" ry="21" transform="rotate(-45 65 65)" />
        <circle cx="50" cy="50" r="6" fill="#166534" />
      </g>
    </svg>
  );
}

export function GiveAwaySection({ count, lastDonated, t, nf }: Props) {
  return (
    <section className="mt-8 text-center">
      <style>{`
        @keyframes ctyr-sway { 0%,100% { transform: rotate(-8deg); } 50% { transform: rotate(8deg); } }
        @media (prefers-reduced-motion: reduce) { .ctyr-sway { animation: none !important; } }
      `}</style>

      {/* 1 · Offer + LinkedIn over a flood of clovers (no card / frame). */}
      <div className="relative mx-auto flex min-h-[22rem] max-w-2xl items-center justify-center px-4">
        {FLOOD.map((c, i) => (
          <span
            key={i}
            aria-hidden
            className="ctyr-sway pointer-events-none absolute"
            style={{
              left: c.l,
              top: c.t,
              opacity: c.op,
              transformOrigin: "bottom center",
              animation: `ctyr-sway ${3.4 + (i % 5) * 0.6}s ease-in-out ${-(i % 6) * 0.5}s infinite`,
            }}
          >
            <FloodClover size={c.size} shade={SHADES[i % SHADES.length]!} />
          </span>
        ))}
        <div className="relative z-10 mx-auto max-w-md">
          <div className="text-3xl" aria-hidden>
            🍀💌
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

      {/* 2 · The clovers drift off and land in the field. */}
      <DriftSvg />

      {/* 3 · Running total. */}
      <p className="mt-2 text-base text-gray-700 sm:text-lg">
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

      {/* 4 · Did you get one? Find it. */}
      <div className="mt-3">
        <DonatedSearchCatcher />
      </div>
    </section>
  );
}
