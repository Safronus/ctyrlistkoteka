"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  AlertTriangle,
  CircleCheck,
  Download,
  Loader2,
  Play,
} from "lucide-react";
import {
  COLLAGE_VARIANTS,
  COLLAGE_VARIANT_LABEL,
  type CollageVariant,
} from "@/lib/collage";
import { CONTROL_H, Field, INPUT_CLS } from "../qr/qr-ui";
import {
  collageViewAction,
  startCollageAction,
  type CollageView,
} from "./actions";

/**
 * The collage workshop: pick a range of finds, pick the patterns, run it,
 * download the result.
 *
 * A run takes minutes, so it happens in a child process and this polls —
 * the same arrangement `/admin/sync` uses. Polling only while something
 * is running; a finished page is static.
 */
export function CollagePanel({ initial }: { initial: CollageView }) {
  const [view, setView] = useState(initial);
  const [minId, setMinId] = useState("1");
  const [maxId, setMaxId] = useState("30000");
  const [variants, setVariants] = useState<CollageVariant[]>([
    ...COLLAGE_VARIANTS,
  ]);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const logRef = useRef<HTMLPreElement>(null);

  const running = view.status?.state === "running";

  const refresh = useCallback(async () => {
    setView(await collageViewAction());
  }, []);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      void refresh();
    }, 2000);
    return () => clearInterval(id);
  }, [running, refresh]);

  useEffect(() => {
    // Follow the tail while it runs — a log you have to scroll is a log
    // nobody reads during a five-minute build.
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [view.log]);

  const run = () => {
    setError(null);
    start(async () => {
      const r = await startCollageAction({ minId, maxId, variants, live });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      await refresh();
    });
  };

  const toggleVariant = (v: CollageVariant) =>
    setVariants((prev) =>
      prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v],
    );

  return (
    <div className="space-y-4">
      <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">Nový vzor</h2>

        <div className="grid items-start gap-4 sm:grid-cols-[8rem_8rem_1fr]">
          <Field label="Od čísla nálezu">
            <input
              className={`${INPUT_CLS} ${CONTROL_H}`}
              inputMode="numeric"
              value={minId}
              onChange={(e) => setMinId(e.target.value)}
            />
          </Field>
          <Field label="Do čísla nálezu">
            <input
              className={`${INPUT_CLS} ${CONTROL_H}`}
              inputMode="numeric"
              value={maxId}
              onChange={(e) => setMaxId(e.target.value)}
            />
          </Field>
          <Field
            label="Které vzory"
            hint="Tvarové varianty potřebují dost ořezů, aby obrys vyšel — u malého rozsahu vyjdou hrubě."
          >
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1">
              {COLLAGE_VARIANTS.map((v) => (
                <label
                  key={v}
                  className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-gray-700"
                >
                  <input
                    type="checkbox"
                    checked={variants.includes(v)}
                    onChange={() => toggleVariant(v)}
                    className="h-3.5 w-3.5 rounded border-gray-300 text-brand-600 focus:ring-brand-500/30"
                  />
                  {COLLAGE_VARIANT_LABEL[v]}
                </label>
              ))}
            </div>
          </Field>
        </div>

        {/* The one switch that can change what strangers see. Off by
            default and spelled out, because the 30 000 backgrounds are
            frozen on purpose — see docs/admin-overview.md. */}
        <label
          className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
            live
              ? "border-amber-300 bg-amber-50 text-amber-900"
              : "border-gray-200 bg-gray-50 text-gray-600"
          }`}
        >
          <input
            type="checkbox"
            checked={live}
            onChange={(e) => setLive(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 rounded border-gray-300 text-amber-600 focus:ring-amber-500/30"
          />
          <span>
            <strong>Přepsat ostrá pozadí kartiček.</strong> Bez zaškrtnutí se
            vzor jen uloží stranou ke stažení a nic na webu se nezmění. Se
            zaškrtnutím nahradí to, co vidí nálezci na{" "}
            <code className="rounded bg-white px-1">/d/…</code> — ta pozadí
            jsou schválně zmražená na 30 000.
          </span>
        </label>

        {error && (
          <p className="flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={run}
            disabled={busy || running}
            className={`${CONTROL_H} inline-flex items-center gap-1.5 rounded-md border border-brand-300 bg-brand-50 px-3 text-sm font-medium text-brand-800 transition hover:bg-brand-100 disabled:opacity-50`}
          >
            {busy || running ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Play className="h-4 w-4" aria-hidden />
            )}
            {running ? "Generuje se…" : "Vygenerovat"}
          </button>
          <span className="text-xs text-gray-500">
            Jeden vzor z celé sbírky trvá kolem minuty; šest tedy zhruba
            pět. Můžeš odejít, běží to na serveru.
          </span>
        </div>
      </section>

      {view.status && (
        <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <h2 className="font-semibold text-gray-900">Poslední běh</h2>
            <StateBadge state={view.status.state} />
            <span className="text-xs text-gray-500">
              nálezy {view.status.minId}–{view.status.maxId} ·{" "}
              {view.status.variants.length} vzorů
              {view.status.live && " · přepsal ostrá pozadí"}
            </span>
          </div>
          <pre
            ref={logRef}
            className="max-h-64 overflow-auto rounded-lg bg-gray-900 p-3 font-mono text-[11px] leading-relaxed text-gray-100"
          >
            {view.log || "…"}
          </pre>
        </section>
      )}

      <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">
          Uložené vzory{" "}
          <span className="font-normal text-xs text-gray-400">
            ({view.batches.length})
          </span>
        </h2>
        {view.batches.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-6 text-center text-xs text-gray-500">
            Zatím nic. Vygeneruj první vzor výš.
          </p>
        ) : (
          <ul className="space-y-3">
            {view.batches.map((b) => (
              <li
                key={b.runId}
                className="rounded-lg border border-gray-200 bg-gray-50 p-3"
              >
                <p className="text-xs font-medium text-gray-700">
                  {b.builtAt ? fmt(b.builtAt) : b.runId}
                </p>
                <ul className="mt-1.5 grid gap-1 sm:grid-cols-2">
                  {b.files.map((f) => (
                    <li key={f.name}>
                      <a
                        href={f.url}
                        download={`ctyrlistkoteka-${b.runId}-${f.name}`}
                        className="inline-flex items-center gap-1.5 text-xs text-brand-700 hover:underline"
                      >
                        <Download className="h-3.5 w-3.5" aria-hidden />
                        {f.name}
                        <span className="text-gray-400">
                          ({Math.round(f.bytes / 1024)} kB)
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-gray-500">
          Vzory leží v{" "}
          <code className="rounded bg-gray-100 px-1">
            generated/collage/vzory/
          </code>{" "}
          a nikdo je sám nemaže — až se ti nahromadí, smaž je na serveru.
        </p>
      </section>
    </div>
  );
}

function StateBadge({ state }: { state: string }) {
  const tone =
    state === "running"
      ? "bg-sky-100 text-sky-900"
      : state === "succeeded"
        ? "bg-emerald-100 text-emerald-900"
        : "bg-red-100 text-red-900";
  const label =
    state === "running"
      ? "běží"
      : state === "succeeded"
        ? "hotovo"
        : state === "crashed"
          ? "spadlo"
          : "selhalo";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone}`}
    >
      {state === "succeeded" && <CircleCheck className="h-3 w-3" aria-hidden />}
      {label}
    </span>
  );
}

const stampFmt = new Intl.DateTimeFormat("cs-CZ", {
  day: "numeric",
  month: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function fmt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : stampFmt.format(d);
}
