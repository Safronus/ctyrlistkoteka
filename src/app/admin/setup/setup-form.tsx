"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startRegistration } from "@simplewebauthn/browser";
import { KeyRound, ShieldAlert } from "lucide-react";
import {
  startRegistrationAction,
  finishRegistrationAction,
} from "./actions";

export function SetupForm() {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("label", label);
      const start = await startRegistrationAction(fd);
      if (!start.ok || !start.options) {
        setError(start.error ?? "Chyba při spuštění registrace.");
        return;
      }
      let attResp;
      try {
        attResp = await startRegistration({ optionsJSON: start.options });
      } catch (err) {
        setError(`Prohlížeč registraci odmítl: ${(err as Error).message}`);
        return;
      }
      const finish = await finishRegistrationAction(attResp);
      if (!finish.ok) {
        setError(finish.error ?? "Ověření registrace selhalo.");
        return;
      }
      router.replace("/admin");
      router.refresh();
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 h-5 w-5 text-brand-600" aria-hidden />
        <div>
          <h2 className="text-base font-semibold text-gray-900">
            První přihlášení — registrace passkey
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            Vytvoř passkey pro tento prohlížeč/zařízení. Bez něj se do
            adminu nedostaneš.
          </p>
        </div>
      </div>

      <label className="block">
        <span className="text-sm font-medium text-gray-900">
          Pojmenování zařízení
        </span>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          required
          minLength={2}
          maxLength={60}
          placeholder="MacBook Pro TouchID"
          className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
        />
        <span className="mt-1 block text-xs text-gray-500">
          Slouží jen pro přehled v auditu, např. „MacBook 16&nbsp;TouchID&ldquo;.
        </span>
      </label>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
          <ShieldAlert className="mt-0.5 h-4 w-4" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={isPending || label.trim().length < 2}
        className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-50"
      >
        {isPending ? "Probíhá registrace…" : "Vytvořit passkey"}
      </button>
    </form>
  );
}
