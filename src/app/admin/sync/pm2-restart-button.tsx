"use client";

import { RotateCcw } from "lucide-react";
import { restartPm2 } from "./pm2-restart-action";

/** Restart-PM2 control on /admin/sync. The button posts the server
 *  action `restartPm2`, which spawns `pm2 restart ctyrlistkoteka`
 *  with a small shell-side delay so the HTTP response flushes
 *  before its own worker dies.
 *
 *  UI design:
 *   - Confirm dialog gates the click — restarts terminate any
 *     in-flight requests against this Node app (uploads, exports,
 *     even an active /admin/sync run), so an accidental press has
 *     real cost.
 *   - Banner copy explains the user-visible blip: the next ~5-10 s
 *     of HTTP traffic to the same worker will see connection-reset
 *     errors as the worker restarts. PM2 cluster mode keeps the
 *     other workers serving, but if there's only one (single-CPU
 *     deploy) the entire site briefly drops.
 *
 *  Lives in its own client component because the parent
 *  /admin/sync/page is a Server Component and the confirm handler
 *  needs the browser. */
export function Pm2RestartButton() {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <header className="mb-2 flex items-center gap-2">
        <RotateCcw className="h-4 w-4 text-amber-600" aria-hidden />
        <h2 className="text-sm font-semibold text-gray-900">
          Restart PM2 procesu
        </h2>
      </header>
      <p className="mb-3 text-xs text-gray-600">
        Spustí <code className="font-mono">pm2 restart ctyrlistkoteka</code>{" "}
        přímo z VPS. Aktuálně probíhající požadavky na tomto Node
        workeru (uploady, dlouhé reporty, případně i běžící{" "}
        <code className="font-mono">sync.ts</code>) se přeruší. V cluster
        módu zbylé workery dál obsluhují, na jedno-CPU deployi se web na
        ~5–10 s krátce odpojí.
      </p>
      <form action={restartPm2}>
        <button
          type="submit"
          onClick={(e) => {
            if (
              !window.confirm(
                "Opravdu restartovat pm2 process `ctyrlistkoteka`? Aktivní požadavky na tomto workeru se přeruší.",
              )
            ) {
              e.preventDefault();
            }
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 shadow-sm transition hover:border-amber-400 hover:bg-amber-50"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          Restartovat PM2
        </button>
      </form>
    </section>
  );
}
