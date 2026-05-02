"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startAuthentication } from "@simplewebauthn/browser";
import { Fingerprint, ShieldAlert } from "lucide-react";
import {
  startAuthenticationAction,
  finishAuthenticationAction,
} from "./actions";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    setError(null);
    startTransition(async () => {
      const start = await startAuthenticationAction();
      if (!start.ok || !start.options) {
        setError(start.error ?? "Nelze spustit ověření.");
        return;
      }
      let assertion;
      try {
        assertion = await startAuthentication({ optionsJSON: start.options });
      } catch (err) {
        setError(`Prohlížeč ověření odmítl: ${(err as Error).message}`);
        return;
      }
      const finish = await finishAuthenticationAction(assertion);
      if (!finish.ok) {
        setError(finish.error ?? "Ověření selhalo.");
        return;
      }
      router.replace("/admin");
      router.refresh();
    });
  };

  return (
    <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <Fingerprint className="mt-0.5 h-5 w-5 text-brand-600" aria-hidden />
        <div>
          <h2 className="text-base font-semibold text-gray-900">
            Přihlášení passkey
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            Klikni a potvrď v Apple Heslech / TouchID / FaceID.
          </p>
        </div>
      </div>
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
          <ShieldAlert className="mt-0.5 h-4 w-4" aria-hidden />
          <span>{error}</span>
        </div>
      )}
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-50"
      >
        {isPending ? "Probíhá ověření…" : "Přihlásit"}
      </button>
    </div>
  );
}
