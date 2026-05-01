/**
 * Shared types + initial state for the home-page recipient lookup
 * action. Lives in its own file (no "use server" directive) because
 * Next.js requires "use server" modules to export ONLY async functions
 * — non-function exports become server references on the client and
 * blow up the form's initial render. Importing types from here on
 * either side is safe.
 */

export interface FindDonationActionState {
  /** Czech message for the failure case, or null on initial render. On
   *  success the action redirects, so the success branch never returns
   *  to the client. */
  error: string | null;
}

export const FIND_DONATION_INITIAL: FindDonationActionState = { error: null };
