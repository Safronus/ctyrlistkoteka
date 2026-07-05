"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { CloverThumbIcon } from "@/components/icons/clover-thumb-icon";

/**
 * Public "thumbs up" toggle. SSR pre-loads the initial state (server
 * already knows from the visitor's cookie/fingerprint whether they
 * voted) — the client just flips it on click and reconciles with the
 * server response.
 *
 * Why a client component: the icon needs to swap (outline → filled),
 * the count needs to update without a full navigation, and the API
 * call needs to surface its result inline. Mirrors the
 * PageSizeSelector pattern documented in docs/gotchas.md §2 — the
 * server passes only data (`initialVoted`, `initialCount`), never a
 * function.
 *
 * One caveat — `onClick` does `e.preventDefault(); e.stopPropagation()`
 * because the button often lives INSIDE a parent `<Link>` (the row
 * card). Without that, clicking the heart would also navigate to the
 * find detail.
 */
export function VoteButton({
  findId,
  initialVoted,
  initialCount,
  /** Compact = no count visible inside the button, just icon (count
   *  appears next to it). Used on grid cards + list-row overlays
   *  where the surrounding chrome is already tight. */
  compact = false,
  /** Visual size — `lg` doubles the icon for use as a real
   *  call-to-action: the find detail header AND the /sbirka list-row
   *  bottom strip both prefer it for the bigger tap target. `md` is
   *  reserved for tight surfaces (grid-card overlays, leaderboard
   *  rows). */
  size = "md",
  /** When true, the button asks GET /api/finds/:id/vote on mount and
   *  reconciles its local state with what the server reports for
   *  this visitor. Use on surfaces rendered in ISR-cached pages
   *  (homepage Popular tile, /statistiky leaderboard) where the
   *  server can't read per-visitor cookies during the cached render
   *  — the freshly-mounted client fetches the truth. /sbirka pages
   *  are dynamic and already pass the correct initial state, so
   *  they leave this off to skip the extra round-trip. */
  autoHydrate = false,
  /** "default" — the bordered pill used in lists/headers. "overlay" —
   *  a round white/blur chip sized to match the crop magnifier, for
   *  drawing on top of the find photo (top-right, beside the lupa). */
  variant = "default",
}: {
  findId: number;
  initialVoted: boolean;
  initialCount: number;
  compact?: boolean;
  size?: "md" | "lg";
  autoHydrate?: boolean;
  variant?: "default" | "overlay";
}) {
  const t = useTranslations("Vote");
  const [voted, setVoted] = useState(initialVoted);
  const [count, setCount] = useState(initialCount);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Self-hydration for ISR / cached surfaces — see prop docstring.
  // Aborts in-flight when the find id changes (e.g. someone keys a
  // remount with a different find), so a slow response can't clobber
  // the new find's state. Failures are silent: the optimistic POST/
  // DELETE flow handles them anyway via P2002 idempotence.
  useEffect(() => {
    if (!autoHydrate) return;
    const ac = new AbortController();
    fetch(`/api/finds/${findId}/vote`, {
      signal: ac.signal,
      credentials: "same-origin",
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { voted?: boolean; count?: number } | null) => {
        if (!data) return;
        if (typeof data.voted === "boolean") setVoted(data.voted);
        if (typeof data.count === "number") setCount(data.count);
      })
      .catch(() => {
        /* swallow — aborted or offline */
      });
    return () => ac.abort();
  }, [autoHydrate, findId]);

  const onClick = (e: React.MouseEvent) => {
    // The button often sits inside a clickable card / list row; we
    // need both preventDefault (anchor click) AND stopPropagation
    // (outer onClick handlers). Without these two together, clicking
    // the heart would also trigger navigation to the detail page.
    e.preventDefault();
    e.stopPropagation();
    if (isPending) return;
    setError(null);

    // Optimistic update: toggle immediately, server will confirm. If
    // the server rejects (429 rate limit, 503 misconfig), we roll back
    // — `wasVoted` snapshots the pre-click state for that purpose.
    const wasVoted = voted;
    const wasCount = count;
    setVoted(!wasVoted);
    setCount(wasVoted ? Math.max(0, wasCount - 1) : wasCount + 1);

    startTransition(async () => {
      try {
        const res = await fetch(`/api/finds/${findId}/vote`, {
          method: wasVoted ? "DELETE" : "POST",
          credentials: "same-origin",
        });
        if (!res.ok) {
          // Roll back optimistic state on any non-2xx. 429 (rate
          // limited) and 503 (salt missing) are the realistic ones;
          // 400/404 only fire on tampered requests we don't worry
          // about much, but we still recover gracefully.
          setVoted(wasVoted);
          setCount(wasCount);
          if (res.status === 429) {
            setError(t("errorRateLimit"));
          } else {
            setError(t("errorGeneric"));
          }
          return;
        }
        const json = (await res.json()) as { voted: boolean; count: number };
        setVoted(json.voted);
        setCount(json.count);
      } catch {
        setVoted(wasVoted);
        setCount(wasCount);
        setError(t("errorNetwork"));
      }
    });
  };

  const label = voted ? t("buttonVoted") : t("buttonVote");

  // Overlay variant — a round white/blur chip matching the crop
  // magnifier (p-2 + h-5 icon = same height), for drawing over the find
  // photo next to the lupa. Icon + count sit inside a single pill.
  if (variant === "overlay") {
    return (
      <span className="inline-flex items-center">
        <button
          type="button"
          onClick={onClick}
          disabled={isPending}
          aria-pressed={voted}
          aria-label={`${label} (${count})`}
          title={voted ? t("tooltipUnvote") : t("tooltipVote")}
          className={`inline-flex items-center gap-1.5 rounded-full p-2 shadow-md ring-1 ring-black/5 backdrop-blur transition focus:outline-none focus:ring-2 focus:ring-brand-500 ${
            voted
              ? "bg-brand-100/95 text-brand-700 hover:bg-brand-200"
              : "bg-white/90 text-brand-700 hover:bg-white hover:text-brand-800"
          } ${isPending ? "opacity-70" : ""}`}
        >
          <CloverThumbIcon
            filled={voted}
            className={`h-5 w-5 transition-transform ${
              isPending ? "scale-95" : voted ? "scale-105" : ""
            } ${voted ? "text-brand-600" : ""}`}
          />
          <span className="font-mono text-sm tabular-nums leading-none">
            {count}
          </span>
        </button>
        {error && (
          <span
            role="status"
            className="ml-1 text-xs text-amber-700"
            aria-live="polite"
          >
            {error}
          </span>
        )}
      </span>
    );
  }

  // Size-table — controls padding, icon size, count font.
  // `lg` is the prominent detail-page CTA + the /sbirka list-row
  // strip; `md` is the inline chip on grid overlays + leaderboard.
  //
  // py-1.5 (not py-2) on lg: the /sbirka list rows put this button at
  // the bottom of the content column next to a 112 px photo
  // thumbnail. With the default py-2 padding the total button height
  // pushed the column past 112 px and the button's bottom edge sat
  // visibly below the photo's bottom edge. py-1.5 brings the button
  // back into alignment without dropping the icon size, so the CTA
  // character is preserved on the detail-page header too.
  const sizes =
    size === "lg"
      ? {
          button: "px-3 py-1.5 text-base gap-1.5",
          icon: "h-6 w-6",
          count: "text-sm",
        }
      : {
          button: "px-2 py-1 text-sm gap-1",
          icon: "h-4 w-4",
          count: "text-xs",
        };

  // Outline/idle state styling: gray on light bg by default, emerald
  // brand color when voted. `lg` mode keeps a visible border + slight
  // shadow even when not voted, so the affordance reads as "click me"
  // instead of "metadata". `md` mode is more subtle (no border when
  // unvoted) so it doesn't fight with the list-row chrome.
  const stateClass = voted
    ? "border border-brand-300 bg-brand-100 text-brand-800 hover:bg-brand-200"
    : size === "lg"
      ? "border border-gray-300 bg-white text-gray-700 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 shadow-sm"
      : "border border-transparent text-gray-500 hover:bg-gray-100 hover:text-brand-700";

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        aria-pressed={voted}
        aria-label={compact ? `${label} (${count})` : label}
        title={voted ? t("tooltipUnvote") : t("tooltipVote")}
        className={`inline-flex items-center rounded-full font-medium transition focus:outline-none focus:ring-2 focus:ring-brand-500/40 ${sizes.button} ${stateClass} ${
          isPending ? "opacity-70" : ""
        }`}
      >
        <CloverThumbIcon
          filled={voted}
          className={`${sizes.icon} transition-transform ${
            isPending ? "scale-95" : voted ? "scale-105" : ""
          } ${voted ? "text-brand-600" : ""}`}
        />
        {!compact && (
          <span className={`font-mono tabular-nums ${sizes.count}`}>
            {count}
          </span>
        )}
      </button>
      {compact && (
        // Count rendered next to the button so the aria label and
        // visible label match. Stays grey so it reads as metadata.
        <span className={`font-mono tabular-nums text-gray-500 ${sizes.count}`}>
          {count}
        </span>
      )}
      {error && (
        <span
          role="status"
          className="text-xs text-amber-700"
          aria-live="polite"
        >
          {error}
        </span>
      )}
    </span>
  );
}
