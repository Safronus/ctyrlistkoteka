"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { resetAllVotes } from "./actions";

/**
 * Heavy-confirm wipe-everything button. Mirrors the "type the literal
 * to confirm" pattern from /admin/blocklist: clicking once expands an
 * inline form that asks the operator to type RESET_ALL exactly. The
 * value rides along to the server action which re-verifies it before
 * touching the table (defense in depth — the client UI is the primary
 * brake, the server check stops a curl posting an empty body).
 */
export function ResetAllVotesButton({ totalVotes }: { totalVotes: number }) {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [isPending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => {
          setTyped("");
          setConfirming(true);
        }}
        disabled={totalVotes === 0}
        className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 transition hover:border-red-400 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Trash2 className="h-4 w-4" aria-hidden />
        Reset všech hlasů
      </button>
    );
  }

  const matches = typed === "RESET_ALL";

  return (
    <form
      action={(fd) => {
        startTransition(async () => {
          try {
            await resetAllVotes(fd);
            setConfirming(false);
            setTyped("");
          } catch (err) {
            // The server action throws on validation errors; Next will
            // surface the message in the closest error.tsx. We don't
            // need an inline error UI here — the wipe is rare enough
            // that the full-page handler is fine.
            console.error(err);
          }
        });
      }}
      className="inline-flex flex-wrap items-center gap-2 rounded-md border border-red-400 bg-red-50 px-3 py-2 text-sm"
    >
      <AlertTriangle className="h-4 w-4 shrink-0 text-red-700" aria-hidden />
      <span className="text-red-900">
        Smazat <strong>{totalVotes.toLocaleString("cs-CZ")}</strong>{" "}
        {totalVotes === 1 ? "hlas" : "hlasů"}? Napiš{" "}
        <code className="rounded bg-white px-1 font-mono">RESET_ALL</code>:
      </span>
      <input
        type="text"
        name="confirm"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        autoComplete="off"
        autoFocus
        spellCheck={false}
        className="w-40 rounded-md border border-red-300 bg-white px-2 py-1 font-mono text-xs uppercase tracking-wide text-red-900 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/30"
      />
      <button
        type="submit"
        disabled={!matches || isPending}
        className="inline-flex items-center gap-1 rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white shadow-sm transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
        Smazat vše
      </button>
      <button
        type="button"
        onClick={() => {
          setConfirming(false);
          setTyped("");
        }}
        disabled={isPending}
        className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        Zrušit
      </button>
    </form>
  );
}
