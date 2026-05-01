"use client";

import { useActionState, useId } from "react";
import { Search, Sparkles } from "lucide-react";
import { findDonationAction } from "@/lib/actions/findDonation";
import { FIND_DONATION_INITIAL } from "@/lib/actions/findDonationTypes";

/**
 * Form pinned under the home-page "donated-clovers" SVG that lets a
 * recipient type the find ID they were given and land on its detail.
 *
 * Server action validates format → existence → DONATED state, then
 * server-side redirects to /sbirka/<id>. On any failure the action
 * returns an error message that we surface inline (aria-live so a
 * screen reader picks it up after submission).
 *
 * The visible icon next to the input echoes the SVG-overlay "catcher"
 * glow above so the visitor sees the form as the natural landing
 * place for the swarm of drifting clovers.
 */
export function DonatedSearchCatcher() {
  const [state, action, pending] = useActionState(
    findDonationAction,
    FIND_DONATION_INITIAL,
  );
  const inputId = useId();
  const errorId = useId();

  return (
    <div className="mx-auto mt-2 max-w-md text-center">
      <p className="text-sm font-medium text-gray-800">
        Dostal/a jsi čtyřlístek?{" "}
        <span className="text-gray-600">Najdi si ten svůj.</span>
      </p>
      <form
        action={action}
        className="mt-2 flex flex-col items-stretch gap-2 sm:flex-row"
        noValidate
      >
        <label htmlFor={inputId} className="sr-only">
          Číslo nálezu
        </label>
        <div className="relative flex-1">
          <Sparkles
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-500"
            aria-hidden
          />
          <input
            id={inputId}
            name="id"
            type="text"
            inputMode="numeric"
            // `pattern` cooperates with the server-side regex; the form
            // also passes noValidate so the friendlier server messages
            // win over the browser's default tooltip.
            pattern="[1-9][0-9]*"
            autoComplete="off"
            placeholder="např. 15234"
            aria-invalid={state.error ? true : undefined}
            aria-describedby={state.error ? errorId : undefined}
            className="block w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 shadow-sm transition placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center gap-1.5 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Search className="h-4 w-4" aria-hidden />
          <span>{pending ? "Hledám…" : "Najít nález"}</span>
        </button>
      </form>
      <p
        id={errorId}
        role="alert"
        aria-live="polite"
        className={`mt-2 min-h-[1.25rem] text-xs ${
          state.error ? "text-rose-700" : "text-transparent"
        }`}
      >
        {state.error ?? "placeholder"}
      </p>
    </div>
  );
}
