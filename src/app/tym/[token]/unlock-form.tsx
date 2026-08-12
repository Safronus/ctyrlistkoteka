"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2 } from "lucide-react";
import { unlockCrewMapAction } from "./actions";

/** The gate. Nothing about the area is rendered above it — not its name,
 *  not how many cards it holds — so a leaked link on its own says nothing. */
export function CrewUnlockForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await unlockCrewMapAction(token, password);
      if (!r.ok) {
        setError(r.error ?? "Heslo nesedí.");
        return;
      }
      // The cookie is set; the page itself decides what to render.
      router.refresh();
    });
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-12">
      <form
        onSubmit={submit}
        className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
      >
        <p className="text-center text-4xl" aria-hidden>
          🍀
        </p>
        <h1 className="mt-4 text-center text-lg font-semibold text-gray-900">
          Mapa pro tým
        </h1>
        <p className="mt-2 text-center text-sm text-gray-500">
          Stránka je jen pro ty, kdo kartičky schovávají. Zadej heslo, které
          jsi dostal.
        </p>

        <label
          htmlFor="crew-password"
          className="mt-6 block text-xs font-medium text-gray-700"
        >
          Heslo
        </label>
        <input
          id="crew-password"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
        />

        {error && (
          <p
            role="alert"
            className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || password.length === 0}
          className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <KeyRound className="h-4 w-4" aria-hidden />
          )}
          Otevřít mapu
        </button>

        <p className="mt-4 text-center text-[11px] leading-relaxed text-gray-400">
          Odkaz ani heslo nikam nepřeposílej — jsou na něm místa všech
          schovaných čtyřlístků.
        </p>
      </form>
    </main>
  );
}
