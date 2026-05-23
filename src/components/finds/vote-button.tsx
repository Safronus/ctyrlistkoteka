"use client";

import { useState, useTransition } from "react";
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
  /** Compact = no count visible, just icon. Used on the grid card
   *  variant where the row is already tight; the count is still
   *  available via the aria-label/tooltip. */
  compact = false,
}: {
  findId: number;
  initialVoted: boolean;
  initialCount: number;
  compact?: boolean;
}) {
  const t = useTranslations("Vote");
  const [voted, setVoted] = useState(initialVoted);
  const [count, setCount] = useState(initialCount);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        aria-pressed={voted}
        aria-label={
          compact
            ? `${label} (${count})`
            : label
        }
        title={voted ? t("tooltipUnvote") : t("tooltipVote")}
        className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm transition focus:outline-none focus:ring-2 focus:ring-brand-500/40 ${
          voted
            ? "bg-brand-100 text-brand-700 hover:bg-brand-200"
            : "text-gray-500 hover:bg-gray-100 hover:text-brand-700"
        } ${isPending ? "opacity-70" : ""}`}
      >
        <CloverThumbIcon
          filled={voted}
          className={`h-4 w-4 transition-transform ${
            isPending ? "scale-95" : ""
          }`}
        />
        {!compact && (
          <span className="font-mono text-xs tabular-nums">{count}</span>
        )}
      </button>
      {compact && (
        // Count rendered next to the button so the aria label and
        // visible label match. Stays grey so it reads as metadata.
        <span className="font-mono text-xs tabular-nums text-gray-500">
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
