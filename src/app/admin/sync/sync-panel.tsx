"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Play,
  RotateCcw,
  XCircle,
} from "lucide-react";

interface SyncStatus {
  runId: string;
  state: "idle" | "running" | "succeeded" | "failed" | "crashed";
  args: string[];
  logFile: string;
  pid: number | null;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  startedBy: string;
}

interface StatusPayload {
  status: SyncStatus | null;
  log: string;
  offset: number;
}

const POLL_INTERVAL_MS = 750;

export function SyncPanel({
  initialStatus,
}: {
  initialStatus: SyncStatus | null;
}) {
  const [status, setStatus] = useState<SyncStatus | null>(initialStatus);
  const [logBuffer, setLogBuffer] = useState<string>("");
  const [offset, setOffset] = useState<number>(0);
  const [dryRun, setDryRun] = useState(true);
  const [only, setOnly] = useState<"all" | "maps" | "finds" | "meta">("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLPreElement>(null);
  const lastSeenRunIdRef = useRef<string | null>(initialStatus?.runId ?? null);

  // Poll while a run is active OR until we've fully consumed a finished
  // run's log. Stop when state ∈ {idle, succeeded, failed, crashed} AND
  // the log has caught up.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const url = `/api/admin/sync/status?offset=${offset}`;
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as StatusPayload;
        if (cancelled) return;
        if (data.status?.runId !== lastSeenRunIdRef.current) {
          // Run changed (new run started). Reset the local log buffer
          // so we don't carry stale content across runs.
          setLogBuffer("");
          setOffset(0);
          lastSeenRunIdRef.current = data.status?.runId ?? null;
        }
        setStatus(data.status);
        if (data.log.length > 0) {
          setLogBuffer((prev) => prev + data.log);
        }
        setOffset(data.offset);
        const isRunning = data.status?.state === "running";
        if (isRunning || data.log.length > 0) {
          timer = setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch (err) {
        if (cancelled) return;
        // Soft retry — transient fetch errors shouldn't kill the
        // whole panel. Back off slightly to avoid a tight loop.
        timer = setTimeout(poll, POLL_INTERVAL_MS * 2);
        setError(err instanceof Error ? err.message : String(err));
      }
    };

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll the log when new content arrives. Skip when the user
  // has scrolled away from the bottom — the heuristic checks distance
  // from the end so a small fudge of e.g. resize doesn't cancel it.
  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 80) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logBuffer]);

  const onStart = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/sync/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dryRun,
          only: only === "all" ? undefined : only,
        }),
      });
      const data = (await r.json()) as
        | SyncStatus
        | { error: string };
      if (!r.ok) {
        throw new Error("error" in data ? data.error : `HTTP ${r.status}`);
      }
      const next = data as SyncStatus;
      setStatus(next);
      setLogBuffer("");
      setOffset(0);
      lastSeenRunIdRef.current = next.runId;
      // Kick the polling loop again — the effect's poll() will fire on
      // its own next tick, but starting from offset 0 means the first
      // pass picks up the empty file and schedules itself.
      const tick = async () => {
        const sr = await fetch(`/api/admin/sync/status?offset=0`, {
          cache: "no-store",
        });
        if (sr.ok) {
          const sd = (await sr.json()) as StatusPayload;
          setStatus(sd.status);
          setLogBuffer(sd.log);
          setOffset(sd.offset);
          if (sd.status?.state === "running" || sd.log.length > 0) {
            setTimeout(tick, POLL_INTERVAL_MS);
          }
        }
      };
      setTimeout(tick, POLL_INTERVAL_MS);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [busy, dryRun, only]);

  const isRunning = status?.state === "running";
  const canStart = !busy && !isRunning;

  return (
    <div className="space-y-3">
      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <header className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-900">Spustit sync</h2>
          <StatusBadge state={status?.state ?? "idle"} />
        </header>

        <fieldset
          disabled={!canStart}
          className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-700"
        >
          <label className="inline-flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
            />
            <span>
              <code className="font-mono">--dry-run</code> (žádné zápisy do
              DB)
            </span>
          </label>
          <label className="inline-flex items-center gap-1.5">
            <span className="text-gray-500">Rozsah:</span>
            <select
              value={only}
              onChange={(e) =>
                setOnly(e.target.value as typeof only)
              }
              className="rounded-md border border-gray-300 bg-white px-2 py-0.5 text-xs"
            >
              <option value="all">vše</option>
              <option value="maps">--only=maps</option>
              <option value="finds">--only=finds</option>
              <option value="meta">--only=meta</option>
            </select>
          </label>
        </fieldset>

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={onStart}
            disabled={!canStart}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Play className="h-4 w-4" aria-hidden />
            )}
            {dryRun ? "Spustit dry-run" : "Spustit sync"}
          </button>
          {status && (
            <span className="text-xs text-gray-500">
              {status.startedAt && (
                <>
                  Posl. start{" "}
                  <time
                    dateTime={status.startedAt}
                    className="font-mono tabular-nums"
                  >
                    {new Date(status.startedAt).toLocaleString("cs-CZ", {
                      timeZone: "Europe/Prague",
                    })}
                  </time>
                </>
              )}
              {status.startedBy && <> · {status.startedBy}</>}
            </span>
          )}
        </div>

        {error && (
          <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-800">
            {error}
          </p>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-gray-900 shadow-sm">
        <header className="flex items-center justify-between border-b border-gray-800 bg-gray-900/80 px-4 py-2 text-xs">
          <span className="font-mono text-gray-400">
            {status?.logFile ?? "log se vytvoří po spuštění"}
          </span>
          <span className="font-mono text-gray-500">
            {offset.toLocaleString("cs-CZ")} B
          </span>
        </header>
        <pre
          ref={logRef}
          className="m-0 max-h-[60vh] min-h-[12rem] overflow-auto whitespace-pre p-4 text-xs leading-relaxed text-gray-100"
        >
          {logBuffer ||
            (isRunning
              ? "Sync právě startuje…"
              : "Žádné výstupy. Klikni „Spustit dry-run / sync“.")}
        </pre>
      </section>
    </div>
  );
}

function StatusBadge({ state }: { state: SyncStatus["state"] | "idle" }) {
  if (state === "running") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        Běží
      </span>
    );
  }
  if (state === "succeeded") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
        Hotovo
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-800">
        <XCircle className="h-3.5 w-3.5" aria-hidden />
        Chyba
      </span>
    );
  }
  if (state === "crashed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-800">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
        Crash
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-700">
      <RotateCcw className="h-3.5 w-3.5" aria-hidden />
      Idle
    </span>
  );
}
