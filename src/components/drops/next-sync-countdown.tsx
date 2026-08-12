"use client";

import { useEffect, useState } from "react";

/** The systemd timer's period — see docs/admin-overview.md. */
export const SYNC_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Counts down to the next expected Google Sheets pull.
 *
 * It is an ESTIMATE and says so, because the app cannot see systemd's
 * schedule: `syncedAt` is stamped on every check (unchanged, changed and
 * failed alike), and the timer fires 5 minutes after the previous run
 * finished — so "last check + 5 min" is the best the app can honestly
 * know. When that moment passes without a new check it says the pull is
 * overdue rather than counting into negative numbers.
 *
 * Shared by the admin's sheet panel and the crew's read-only page: the
 * crew needs it most, because "did my edit in the table arrive yet" is
 * exactly the question that sends people to the admin owner.
 */
export function NextSyncCountdown({
  syncedAt,
  className = "text-gray-500",
}: {
  syncedAt: string | null;
  className?: string;
}) {
  // `null` until mounted, on purpose: the server has no idea what time it
  // is on the visitor's machine, so rendering a countdown into the HTML
  // would ship a number that is already wrong and mismatch on hydration.
  // The one extra render that costs is the whole point of the pattern —
  // it happens once, on mount, and never cascades.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!syncedAt || now === null) return null;
  const last = new Date(syncedAt).getTime();
  if (Number.isNaN(last)) return null;

  const remaining = last + SYNC_INTERVAL_MS - now;
  return (
    <span className={className}>
      Další kontrola:{" "}
      <strong className={remaining > 0 ? "text-gray-800" : "text-amber-700"}>
        {remaining > 0 ? `za ${mmss(remaining)}` : "měla už proběhnout"}
      </strong>
    </span>
  );
}

/** `m:ss` for a positive duration in milliseconds. */
function mmss(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
