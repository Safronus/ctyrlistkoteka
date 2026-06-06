import { Linkedin } from "lucide-react";
import { getTranslations } from "next-intl/server";

/**
 * Closing "Disclaimer" card at the bottom of the home page (after
 * Retrospektiva): a warm apology that the listed spots may already be
 * picked, plus an offer to send a clover — luck is free. An elegant
 * gradient card with a few faintly drifting clovers in the background.
 */

const LINKEDIN_URL = "https://www.linkedin.com/in/petr-žáček-9a2473b7/";

// Background drifters — position / size / animation per clover. Purely
// decorative; the keyframes below pause under prefers-reduced-motion.
const DRIFTERS = [
  { left: "5%", top: "16%", size: 28, delay: "0s", dur: "13s", op: 0.16 },
  { left: "14%", top: "66%", size: 18, delay: "-3s", dur: "16s", op: 0.13 },
  { left: "83%", top: "20%", size: 32, delay: "-6s", dur: "15s", op: 0.15 },
  { left: "91%", top: "70%", size: 20, delay: "-2s", dur: "12s", op: 0.12 },
  { left: "49%", top: "10%", size: 16, delay: "-9s", dur: "18s", op: 0.1 },
  { left: "72%", top: "82%", size: 22, delay: "-5s", dur: "14s", op: 0.14 },
];

export async function DisclaimerSection() {
  const t = await getTranslations("Home");
  return (
    <section className="mt-12">
      {/* No card frame — it reads as a plain hand-written note; the faint
          drifting clovers are the only decoration. overflow-hidden keeps
          the drifters within this block. */}
      <div className="relative mx-auto max-w-3xl overflow-hidden px-6 py-6 text-center sm:px-10 sm:py-8">
        <style>{`
          @keyframes ctyr-disc-drift {
            0%   { transform: translateY(0) rotate(0deg); }
            50%  { transform: translateY(-14px) rotate(20deg); }
            100% { transform: translateY(0) rotate(0deg); }
          }
          @media (prefers-reduced-motion: reduce) {
            .ctyr-disc-drifter { animation: none !important; }
          }
        `}</style>

        {DRIFTERS.map((d, i) => (
          <span
            key={i}
            aria-hidden
            className="ctyr-disc-drifter pointer-events-none absolute"
            style={{
              left: d.left,
              top: d.top,
              opacity: d.op,
              animation: `ctyr-disc-drift ${d.dur} ease-in-out ${d.delay} infinite`,
            }}
          >
            <CloverMark size={d.size} />
          </span>
        ))}

        <div className="relative z-10">
          <div className="text-3xl" aria-hidden>
            🍀😇💌
          </div>
          <h2 className="mt-3 text-xl font-bold tracking-tight text-gray-900">
            {t("disclaimerHeading")}
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-[15px] leading-relaxed text-gray-600">
            {t("disclaimerApology")}
          </p>
          <p className="mx-auto mt-2 max-w-2xl text-[15px] leading-relaxed text-gray-600">
            {t("disclaimerOffer")}
          </p>
          <p className="mt-4 text-xl font-bold text-brand-700">
            {t("disclaimerTagline")}
          </p>
          <div className="mt-5 flex justify-center">
            <a
              href={LINKEDIN_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
            >
              <Linkedin className="h-4 w-4" aria-hidden />
              {t("disclaimerCta")}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function CloverMark({ size }: { size: number }) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className="block"
      aria-hidden
    >
      <g fill="#4d9748">
        <ellipse cx="35" cy="35" rx="18" ry="22" transform="rotate(-45 35 35)" />
        <ellipse cx="65" cy="35" rx="18" ry="22" transform="rotate(45 65 35)" />
        <ellipse cx="35" cy="65" rx="18" ry="22" transform="rotate(45 35 65)" />
        <ellipse cx="65" cy="65" rx="18" ry="22" transform="rotate(-45 65 65)" />
        <circle cx="50" cy="50" r="6" fill="#0f6e34" />
      </g>
    </svg>
  );
}
