"use client";

import { useState } from "react";
import Image from "next/image";
import { Linkedin } from "lucide-react";

/**
 * DEBUG showcase: all four "Disclaimer" design concepts behind a switcher
 * so the owner can preview them live and pick one. Once chosen, delete the
 * other three variants + the switcher and keep the winner (and wire its
 * copy into the cs/en message bundle — text is hardcoded Czech here just
 * for the preview). Sits at the bottom of the home page, after the
 * Retrospektiva section.
 */

const LINKEDIN_URL = "https://www.linkedin.com/in/petr-žáček-9a2473b7/";

const COPY = {
  heading: "Malá omluva na závěr",
  apology:
    "Pokud jste na některém z uvedených míst hledali a žádný čtyřlístek nenašli — moc se omlouvám 😅. Nejspíš jsem byl rychlejší a už ho mám ve sbírce.",
  offer:
    "Kdybyste chtěli čtyřlístek pro sebe nebo ho poslat někomu pro radost, ozvěte se mi na LinkedIn — domluvíme se na detailech. (A kdo mě zná, klidně i jinak. 🙂)",
  tagline: "Štěstí není nikdy dost a rozdávat se má zadarmo :)",
};

export function DisclaimerShowcase() {
  const [variant, setVariant] = useState<"A" | "B" | "C" | "D">("A");
  const variants = [
    { k: "A", label: "Pohlednice" },
    { k: "B", label: "Plovoucí čtyřlístky" },
    { k: "C", label: "Elegantní karta" },
    { k: "D", label: "Spotlight" },
  ] as const;

  return (
    <section className="mt-12">
      {/* DEBUG switcher — remove once a variant is chosen. */}
      <div className="mb-5 flex flex-wrap items-center justify-center gap-2 rounded-lg border border-dashed border-amber-300 bg-amber-50/60 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-amber-700">
          DEBUG · varianta:
        </span>
        {variants.map((v) => (
          <button
            key={v.k}
            type="button"
            onClick={() => setVariant(v.k)}
            aria-pressed={variant === v.k}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
              variant === v.k
                ? "bg-amber-600 text-white"
                : "bg-white text-amber-800 ring-1 ring-amber-300 hover:bg-amber-100"
            }`}
          >
            {v.k} · {v.label}
          </button>
        ))}
      </div>

      {variant === "A" && <PostcardVariant />}
      {variant === "B" && <FloatingVariant />}
      {variant === "C" && <ElegantVariant />}
      {variant === "D" && <SpotlightVariant />}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Shared pieces

function LinkedInCta() {
  return (
    <a
      href={LINKEDIN_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 rounded-full bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
    >
      <Linkedin className="h-4 w-4" aria-hidden />
      Napsat na LinkedIn
    </a>
  );
}

function Signature() {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-gray-500">
      <Image
        src="/safronus.png"
        alt=""
        aria-hidden
        width={24}
        height={24}
        className="theme-invertible h-6 w-6"
      />
      Safronus
    </span>
  );
}

function CloverMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden>
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

// ---------------------------------------------------------------------------
// A) Postcard / přání — cream paper, slight tilt, corner stamp, signature

function PostcardVariant() {
  return (
    <div className="mx-auto max-w-2xl px-2">
      <div className="relative -rotate-1 rounded-2xl border border-amber-200/80 bg-[#fffdf7] p-7 shadow-[0_10px_30px_-12px_rgba(120,90,30,0.35)] sm:p-9">
        {/* perforated "stamp" */}
        <div className="absolute -right-2 -top-3 rotate-6">
          <div className="rounded-md border-2 border-dashed border-brand-300 bg-white/80 p-1.5 shadow-sm">
            <CloverMark className="h-9 w-9" />
          </div>
        </div>
        <h2 className="text-xl font-bold tracking-tight text-gray-900">
          {COPY.heading} 🍀
        </h2>
        <p className="mt-3 text-[15px] italic leading-relaxed text-gray-700">
          {COPY.apology}
        </p>
        <p className="mt-2 text-[15px] italic leading-relaxed text-gray-700">
          {COPY.offer}
        </p>
        <p className="mt-4 text-lg font-semibold text-brand-700">
          {COPY.tagline}
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <LinkedInCta />
          <Signature />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// B) Floating clovers — green gradient panel with drifting clovers

function FloatingVariant() {
  const drifters = [
    { left: "6%", top: "18%", size: 26, delay: "0s", dur: "13s", op: 0.18 },
    { left: "16%", top: "62%", size: 18, delay: "-3s", dur: "16s", op: 0.14 },
    { left: "82%", top: "22%", size: 30, delay: "-6s", dur: "15s", op: 0.16 },
    { left: "90%", top: "68%", size: 20, delay: "-2s", dur: "12s", op: 0.13 },
    { left: "48%", top: "12%", size: 16, delay: "-9s", dur: "18s", op: 0.12 },
    { left: "70%", top: "80%", size: 22, delay: "-5s", dur: "14s", op: 0.15 },
  ];
  return (
    <div className="relative mx-auto max-w-3xl overflow-hidden rounded-2xl bg-gradient-to-br from-brand-50 via-white to-brand-50 p-8 text-center shadow-sm ring-1 ring-brand-100 sm:p-10">
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
      {drifters.map((d, i) => (
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
          <CloverMark className="block" />
          <span style={{ display: "block", width: d.size, height: d.size }} />
        </span>
      ))}
      <div className="relative z-10">
        <h2 className="text-xl font-bold tracking-tight text-gray-900">
          {COPY.heading} 🍀
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-gray-700">
          {COPY.apology}
        </p>
        <p className="mx-auto mt-2 max-w-xl text-[15px] leading-relaxed text-gray-700">
          {COPY.offer}
        </p>
        <p className="mt-5 text-xl font-bold text-brand-700">{COPY.tagline}</p>
        <div className="mt-6 flex flex-col items-center gap-3">
          <LinkedInCta />
          <Signature />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// C) Elegant card — restrained, emoji row, clear CTA

function ElegantVariant() {
  return (
    <div className="mx-auto max-w-2xl rounded-2xl border border-gray-200 bg-gradient-to-br from-brand-50/70 to-white p-8 text-center shadow-sm sm:p-10">
      <div className="text-3xl" aria-hidden>
        🍀😅💌
      </div>
      <h2 className="mt-3 text-xl font-bold tracking-tight text-gray-900">
        {COPY.heading}
      </h2>
      <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-gray-600">
        {COPY.apology}
      </p>
      <p className="mx-auto mt-2 max-w-xl text-[15px] leading-relaxed text-gray-600">
        {COPY.offer}
      </p>
      <p className="mt-5 text-xl font-bold text-brand-700">{COPY.tagline}</p>
      <div className="mt-6 flex flex-col items-center gap-3">
        <LinkedInCta />
        <Signature />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// D) Spotlight — the tagline is the hero

function SpotlightVariant() {
  return (
    <div className="mx-auto max-w-3xl px-4 text-center">
      <p className="mx-auto max-w-2xl text-sm leading-relaxed text-gray-500">
        <span className="font-semibold text-gray-700">{COPY.heading} 🍀</span>{" "}
        — {COPY.apology}
      </p>
      <p className="mx-auto mt-5 max-w-2xl text-3xl font-extrabold leading-tight tracking-tight text-brand-700 sm:text-4xl">
        {COPY.tagline}
      </p>
      <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-gray-600">
        {COPY.offer}
      </p>
      <div className="mt-6 flex flex-col items-center gap-3">
        <LinkedInCta />
        <Signature />
      </div>
    </div>
  );
}
