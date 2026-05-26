"use client";

import { useState, useTransition } from "react";
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  RefreshCcw,
  Save,
  Trash2,
} from "lucide-react";
import { setFindUnlockCode } from "./unlock-code-action";

/** Crockford-base32-ish alphabet — uppercase, no 0/O/I/1/L so a
 *  recipient typing the code from a notification can't misread it.
 *  6 characters from this 28-letter pool = ~28.7 bits of entropy,
 *  enough against the verifier's 600 ms-per-attempt stall (~5e7
 *  years to brute-force, even ignoring Nginx's rate limit on top). */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const DEFAULT_CODE_LENGTH = 6;

function generateCode(length = DEFAULT_CODE_LENGTH): string {
  const bytes = new Uint8Array(length);
  // crypto.getRandomValues is available in every modern browser AND
  // is the correct primitive — Math.random doesn't give us uniform
  // unpredictability and the difference is observable when the
  // sequence has to resist a brute-force search.
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) {
    out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  }
  return out;
}

interface Props {
  findId: number;
  /** Persisted code as of last server render. `null` means the find
   *  has no per-find override — verifier falls back to the global
   *  FIND_PHOTO_UNLOCK_CODE env var for anonymous photos here. */
  initialCode: string | null;
}

/** Per-find unlock-code admin panel. Lives on
 *  /admin/files/donation-photos/<filename> below the file preview.
 *  Generates, edits, saves, and clears the code that recipients of
 *  THIS find's gift type to view the anonymous donation photo(s) on
 *  the public /sbirka/<id> page. */
export function UnlockCodePanel({ findId, initialCode }: Props) {
  const [savedCode, setSavedCode] = useState<string | null>(initialCode);
  // `value` is the editor's current text. Empty string means the
  // field is empty regardless of whether the saved state is null or
  // a real string — keep these decoupled so "edit then bail" works.
  const [value, setValue] = useState(initialCode ?? "");
  const [reveal, setReveal] = useState(false);
  const [copiedAt, setCopiedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const dirty = (savedCode ?? "") !== value;

  const handleGenerate = () => {
    setError(null);
    setValue(generateCode());
    setReveal(true);
  };

  const handleSave = () => {
    setError(null);
    const trimmed = value.trim();
    startTransition(async () => {
      // `""` is the editor's "no value" — send null so the action
      // semantically clears the column. Server validates length on
      // its side, this is just a normalisation.
      const r = await setFindUnlockCode(
        findId,
        trimmed.length === 0 ? null : trimmed,
      );
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setSavedCode(r.code);
      setValue(r.code ?? "");
    });
  };

  const handleClear = () => {
    setError(null);
    setValue("");
    startTransition(async () => {
      const r = await setFindUnlockCode(findId, null);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setSavedCode(null);
      setValue("");
    });
  };

  const handleCopy = async () => {
    const target = savedCode ?? value.trim();
    if (target.length === 0) return;
    try {
      await navigator.clipboard.writeText(target);
      setCopiedAt(Date.now());
      setTimeout(() => setCopiedAt((c) => (c === null ? null : null)), 1500);
    } catch {
      // Clipboard API can fail (Safari permission, insecure context).
      // Surface a plain error so the admin sees something happened.
      setError("Schránka nedostupná — zkopíruj kód ručně z políčka.");
    }
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <header className="mb-3 flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-brand-600" aria-hidden />
        <h2 className="text-sm font-semibold text-gray-900">
          Odemykací kód pro nález #{findId}
        </h2>
      </header>

      <p className="mb-3 text-xs text-gray-600">
        Kód, který obdarovaný zadá na veřejné stránce nálezu pro
        zobrazení anonymizované fotky daru.{" "}
        <strong>Když je nastavený, přebíjí globální kód</strong>{" "}
        (<code className="font-mono">FIND_PHOTO_UNLOCK_CODE</code>{" "}
        z .env) pro tento nález — globální zůstává pro nálezy, kde
        per-find kód nemají.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex flex-1 items-center">
          <input
            type={reveal ? "text" : "password"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={
              savedCode
                ? "(nastavený — kliknutím na oko zobrazíš)"
                : "Není nastavený — používá se globální kód"
            }
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 pr-10 font-mono text-sm text-gray-900 placeholder:font-sans placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            autoComplete="off"
            spellCheck={false}
            disabled={isPending}
          />
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            aria-label={reveal ? "Skrýt kód" : "Zobrazit kód"}
            className="absolute right-1.5 inline-flex h-6 w-6 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-gray-900"
          >
            {reveal ? (
              <EyeOff className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Eye className="h-3.5 w-3.5" aria-hidden />
            )}
          </button>
        </div>

        <button
          type="button"
          onClick={handleGenerate}
          disabled={isPending}
          title="Vygenerovat nový náhodný kód (6 znaků)"
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 transition hover:border-gray-400 hover:bg-gray-50 disabled:opacity-60"
        >
          <RefreshCcw className="h-3.5 w-3.5" aria-hidden />
          Vygenerovat
        </button>

        <button
          type="button"
          onClick={handleCopy}
          disabled={
            isPending || (savedCode === null && value.trim().length === 0)
          }
          title="Zkopírovat aktuální kód do schránky"
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 transition hover:border-gray-400 hover:bg-gray-50 disabled:opacity-60"
        >
          {copiedAt ? (
            <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
          ) : (
            <Copy className="h-3.5 w-3.5" aria-hidden />
          )}
          {copiedAt ? "Zkopírováno" : "Kopírovat"}
        </button>

        <button
          type="button"
          onClick={handleSave}
          disabled={isPending || !dirty}
          className="inline-flex items-center gap-1.5 rounded-md border border-brand-600 bg-brand-600 px-2.5 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Save className="h-3.5 w-3.5" aria-hidden />
          )}
          Uložit
        </button>

        {savedCode !== null && (
          <button
            type="button"
            onClick={handleClear}
            disabled={isPending}
            title="Smazat per-find kód → vrátit se ke globálnímu"
            className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 transition hover:border-red-400 hover:bg-red-50 disabled:opacity-60"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            Smazat
          </button>
        )}
      </div>

      {error && (
        <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
          {error}
        </p>
      )}

      {dirty && !isPending && !error && (
        <p className="mt-2 text-xs text-amber-700">
          Neuložené změny — klikni na „Uložit“ nebo opusť stránku
          pro zrušení.
        </p>
      )}
    </section>
  );
}
