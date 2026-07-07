"use client";

import { useEffect, useState } from "react";

/**
 * Global error boundary — replaces the whole app (root layout included) when
 * something throws at the top level. The usual real-world trigger is a
 * DEPLOY: a browser holding the old HTML asks for a hashed chunk the new
 * build already replaced → ChunkLoadError. Instead of Next's bleak default
 * ("Application error: a client-side exception has occurred"), show a
 * friendly, animated, clover-themed screen; for the deploy/chunk case,
 * auto-reload to pick up the new build.
 *
 * Fully self-contained: global-error.tsx renders its own <html>/<body> and
 * runs OUTSIDE the app's providers + global stylesheet, so everything here is
 * inline styles + one <style> block — no Tailwind, no next-intl.
 */

const MESSAGES = [
  "Sázíme nové čtyřlístky…",
  "Zaléváme čerstvé štěstí…",
  "Čtyřlístky rostou proti hodinám…",
  "Ladíme sbírku do nového hávu…",
];

const HEART =
  "M0 0 C-8 -5 -16.5 -13.5 -16.5 -22.5 C-16.5 -30.5 -12.5 -36 -7 -36 " +
  "C-3 -36 -1 -32 0 -27.5 C1 -32 3 -36 7 -36 C12.5 -36 16.5 -30.5 16.5 -22.5 " +
  "C16.5 -13.5 8 -5 0 0 Z";

function isChunkError(error?: { name?: string; message?: string }): boolean {
  const s = `${error?.name ?? ""} ${error?.message ?? ""}`;
  return /chunk|loading (css )?chunk|dynamically imported|failed to fetch|import\(/i.test(
    s,
  );
}

/** The site's clover mark (the same one on /mapa) — heart leaves + outline. */
function BigClover() {
  const leaves = (fill: string) =>
    [45, 135, 225, 315].map((a) => (
      <path
        key={a}
        transform={`translate(50 50) rotate(${a})`}
        d={HEART}
        fill={fill}
      />
    ));
  const centre = (fill: string) => (
    <g transform="translate(50 50)" fill={fill}>
      {[0, 90, 180, 270].map((a) => (
        <path key={a} transform={`rotate(${a})`} d="M0 -27 L -2.6 -4 L 2.6 -4 Z" />
      ))}
      <circle r="5" />
    </g>
  );
  return (
    <svg
      viewBox="0 0 100 100"
      width="130"
      height="130"
      className="ctyr-clover"
      aria-hidden
    >
      <g transform="translate(50 50) scale(1.18) translate(-50 -50)">
        <path
          d="M50 49 q 3 15 12 20"
          fill="none"
          stroke="#0b5c2a"
          strokeWidth="4.5"
          strokeLinecap="round"
        />
        {leaves("#0b5c2a")}
        {centre("#0b5c2a")}
      </g>
      <path
        d="M50 49 q 3 15 12 20"
        fill="none"
        stroke="#15803d"
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      {leaves("#15803d")}
      {centre("#0b5c2a")}
    </svg>
  );
}

function MiniClover({ size, shade }: { size: number; shade: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <g fill={shade}>
        <circle cx="12" cy="7" r="4.2" />
        <circle cx="7" cy="12" r="4.2" />
        <circle cx="17" cy="12" r="4.2" />
        <circle cx="12" cy="17" r="4.2" />
        <circle cx="12" cy="12" r="2.4" fill="#166534" />
      </g>
    </svg>
  );
}

const FLOATERS = [
  { left: "10%", size: 26, dur: "7s", delay: "0s", shade: "#3f9142" },
  { left: "23%", size: 18, dur: "9s", delay: "-2s", shade: "#57a457" },
  { left: "37%", size: 22, dur: "8s", delay: "-4.5s", shade: "#2f8038" },
  { left: "61%", size: 20, dur: "10s", delay: "-1s", shade: "#4d9748" },
  { left: "75%", size: 28, dur: "7.5s", delay: "-3s", shade: "#3f9142" },
  { left: "89%", size: 16, dur: "9.5s", delay: "-5.5s", shade: "#57a457" },
];

const SPARKLES = [
  { left: "26%", top: "26%", delay: "0s" },
  { left: "70%", top: "22%", delay: "0.6s" },
  { left: "60%", top: "46%", delay: "1.1s" },
  { left: "36%", top: "42%", delay: "1.7s" },
];

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  const deploy = isChunkError(error);
  const [msg, setMsg] = useState(0);
  const [secs, setSecs] = useState(4);

  useEffect(() => {
    const id = setInterval(() => setMsg((m) => (m + 1) % MESSAGES.length), 2600);
    return () => clearInterval(id);
  }, []);

  // Auto-reload on the deploy/chunk case — a hard reload fetches the new
  // build. Guard against loops: at most one auto-reload per 20 s per tab.
  useEffect(() => {
    if (!deploy) return;
    const KEY = "ctyr-chunk-reload-at";
    const last = Number(sessionStorage.getItem(KEY) ?? "0");
    if (Date.now() - last < 20000) return;
    const tick = setInterval(() => setSecs((s) => Math.max(0, s - 1)), 1000);
    const to = setTimeout(() => {
      sessionStorage.setItem(KEY, String(Date.now()));
      window.location.reload();
    }, 4000);
    return () => {
      clearInterval(tick);
      clearTimeout(to);
    };
  }, [deploy]);

  return (
    <html lang="cs">
      <body style={{ margin: 0 }}>
        <style>{`
          @keyframes ctyr-sway { 0%,100% { transform: rotate(-5deg); } 50% { transform: rotate(5deg); } }
          @keyframes ctyr-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
          @keyframes ctyr-rise {
            0%   { transform: translateY(18vh) rotate(0deg) scale(0.7); opacity: 0; }
            12%  { opacity: 0.9; }
            88%  { opacity: 0.5; }
            100% { transform: translateY(-95vh) rotate(170deg) scale(1); opacity: 0; }
          }
          @keyframes ctyr-twinkle { 0%,100% { opacity: 0.2; transform: scale(0.7); } 50% { opacity: 1; transform: scale(1.25); } }
          @keyframes ctyr-fade { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
          .ctyr-clover { filter: drop-shadow(0 8px 14px rgba(21,128,61,0.28)); animation: ctyr-sway 3.2s ease-in-out infinite; transform-origin: 50% 85%; }
          .ctyr-bob { animation: ctyr-bob 3.4s ease-in-out infinite; }
          @media (prefers-reduced-motion: reduce) {
            .ctyr-clover, .ctyr-bob, .ctyr-floater, .ctyr-sparkle { animation: none !important; }
          }
        `}</style>
        <main
          style={{
            position: "relative",
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            textAlign: "center",
            overflow: "hidden",
            background:
              "radial-gradient(1100px 620px at 50% -8%, #eafaea 0%, #dff2df 45%, #cdeccd 100%)",
            fontFamily:
              'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
            color: "#14532d",
          }}
        >
          {/* rising clovers */}
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              overflow: "hidden",
            }}
          >
            {FLOATERS.map((f, i) => (
              <span
                key={i}
                className="ctyr-floater"
                style={{
                  position: "absolute",
                  bottom: 0,
                  left: f.left,
                  animation: `ctyr-rise ${f.dur} linear ${f.delay} infinite`,
                }}
              >
                <MiniClover size={f.size} shade={f.shade} />
              </span>
            ))}
          </div>

          {/* clover + sparkles */}
          <div
            style={{
              position: "relative",
              width: "184px",
              height: "184px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {SPARKLES.map((s, i) => (
              <span
                key={i}
                className="ctyr-sparkle"
                aria-hidden
                style={{
                  position: "absolute",
                  left: s.left,
                  top: s.top,
                  fontSize: "18px",
                  animation: `ctyr-twinkle 1.8s ease-in-out ${s.delay} infinite`,
                }}
              >
                ✨
              </span>
            ))}
            <div className="ctyr-bob">
              <BigClover />
            </div>
          </div>

          <h1
            key={msg}
            style={{
              margin: "6px 0 0",
              fontSize: "24px",
              fontWeight: 700,
              letterSpacing: "-0.01em",
              minHeight: "30px",
              animation: "ctyr-fade 0.5s ease",
            }}
          >
            🍀 {MESSAGES[msg]}
          </h1>
          <p
            style={{
              margin: "10px 0 0",
              maxWidth: "430px",
              fontSize: "15px",
              lineHeight: 1.6,
              color: "#3f7150",
            }}
          >
            {deploy
              ? "Web se právě aktualizuje — chytám novou verzi. Štěstí přece neuteče. 😇"
              : "Něco se na chvilku zaseklo. Nadechni se, dej čtyřlístku vteřinku a zkus to znovu. 🌱"}
          </p>

          {deploy && (
            <p
              aria-live="polite"
              style={{ margin: "14px 0 0", fontSize: "13px", color: "#6b8f78" }}
            >
              Sám se obnovím za {secs} s…
            </p>
          )}

          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: "20px",
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              border: "none",
              borderRadius: "999px",
              background: "#15803d",
              color: "#fff",
              padding: "11px 22px",
              fontSize: "15px",
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: "0 6px 16px rgba(21,128,61,0.35)",
            }}
          >
            🍀 Zkusit hned
          </button>
        </main>
      </body>
    </html>
  );
}
