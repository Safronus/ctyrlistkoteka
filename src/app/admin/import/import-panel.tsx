"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CloudUpload,
  Database,
  FileArchive,
  Loader2,
  PackageOpen,
  RotateCcw,
  X,
} from "lucide-react";
// Type-only import — erased at compile time, so the server-only module
// (node:fs, yauzl) it lives in never reaches the client bundle.
import type {
  ImportFileSummary,
  ImportMapEntry,
  ImportPlan,
  ImportScopeStat,
} from "@/lib/admin/importZip";
// lspMerge is a pure lib (no node/"use server"), so importing its diff type
// is safe for the client bundle.
import type { WholeFileMergeSectionDiff } from "@/lib/admin/lspMerge";
import { compactToRanges } from "@/lib/parseRanges";

/** Structural subset of the server's WholeFileMergeResult. Declared locally
 *  rather than imported because that type lives in a "use server" module,
 *  and Next.js rejects importing anything (even a type) from such a module
 *  into a client component. The API response is plain JSON, so a subset is
 *  all the summary UI needs. */
type LspMergeResult = {
  ok: boolean;
  noChanges?: boolean;
  conflicts?: unknown[];
  error?: string;
};

/** Client-side chunk size. The upload route accepts up to 16 MB but we send
 *  8 MB to stay under the ~10 MB body-truncation cap (same reason the photo
 *  uploader batches at 8 MB). */
const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
/** Mirror of MAX_IMPORT_ZIP_BYTES (server rejects above this too). */
const MAX_ZIP_BYTES = 2 * 1024 * 1024 * 1024;

type Phase =
  | { kind: "idle" }
  | { kind: "uploading"; fileName: string; total: number; sent: number }
  | { kind: "analyzing"; fileName: string }
  | { kind: "review"; uploadId: string; fileName: string; plan: ImportPlan }
  | { kind: "committing"; fileName: string }
  | {
      kind: "done";
      fileName: string;
      summary: ImportFileSummary;
      lsp: LspMergeResult | null;
    }
  | { kind: "error"; message: string };

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let parsed: (T & { ok?: boolean; error?: string }) | null = null;
  try {
    parsed = (await r.json()) as T & { ok?: boolean; error?: string };
  } catch {
    throw new Error(
      r.ok ? "Server vrátil neparsovatelnou odpověď." : `HTTP ${r.status}`,
    );
  }
  if (!r.ok || parsed.ok === false) {
    throw new Error(parsed.error ?? `HTTP ${r.status}`);
  }
  return parsed;
}

/** Client mirror of the server's CollisionMode. */
type CollisionChoice = "overwrite" | "skip";

export function ImportPanel() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [dragActive, setDragActive] = useState(false);
  // What to do with finds/crops/maps whose id already exists on the server.
  // Overwrite is the historical default; per-package, reset on each upload.
  const [collision, setCollision] = useState<CollisionChoice>("overwrite");
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Id of the upload whose (partial or full) temp ZIP is still on disk.
  // Cleared once the server has deleted it (commit's finally) so we don't
  // fire a pointless discard afterwards.
  const uploadIdRef = useRef<string | null>(null);

  /** Tell the server to delete the temp ZIP now (frees disk immediately
   *  instead of waiting for the import-tmp cron). Fire-and-forget, no-op on
   *  an already-gone id. */
  const discardUpload = useCallback((uploadId: string) => {
    fetch("/admin/api/import/cancel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uploadId }),
    }).catch(() => undefined);
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    const id = uploadIdRef.current;
    uploadIdRef.current = null;
    if (id) discardUpload(id); // discard a partial/uploaded ZIP off disk
    setPhase({ kind: "idle" });
    if (inputRef.current) inputRef.current.value = "";
  }, [discardUpload]);

  const start = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".zip")) {
      setPhase({ kind: "error", message: "Nahraj prosím soubor .zip." });
      return;
    }
    if (file.size === 0) {
      setPhase({ kind: "error", message: "Soubor je prázdný." });
      return;
    }
    if (file.size > MAX_ZIP_BYTES) {
      setPhase({
        kind: "error",
        message: `Balíček je větší než ${fmtBytes(MAX_ZIP_BYTES)}.`,
      });
      return;
    }

    setCollision("overwrite"); // fresh package → default choice
    const uploadId = crypto.randomUUID();
    uploadIdRef.current = uploadId; // temp ZIP now (partially) on disk
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase({ kind: "uploading", fileName: file.name, total: file.size, sent: 0 });

    try {
      // 1) Stream the ZIP up in 8 MB chunks, each written at its byte
      //    offset into the temp file on disk.
      for (let offset = 0; offset < file.size; offset += UPLOAD_CHUNK_BYTES) {
        const end = Math.min(offset + UPLOAD_CHUNK_BYTES, file.size);
        const blob = file.slice(offset, end);
        const r = await fetch(
          `/admin/api/import/upload-chunk?uploadId=${uploadId}&offset=${offset}`,
          { method: "POST", body: blob, signal: controller.signal },
        );
        const j = (await r.json().catch(() => null)) as
          | { ok?: boolean; error?: string }
          | null;
        if (!r.ok || j?.ok === false) {
          throw new Error(j?.error ?? `Nahrávání selhalo (HTTP ${r.status}).`);
        }
        setPhase({ kind: "uploading", fileName: file.name, total: file.size, sent: end });
      }

      // 2) Read-only analysis.
      setPhase({ kind: "analyzing", fileName: file.name });
      const { plan } = await postJson<{ ok: true; plan: ImportPlan }>(
        "/admin/api/import/analyze",
        { uploadId },
      );
      abortRef.current = null;
      setPhase({ kind: "review", uploadId, fileName: file.name, plan });
    } catch (err) {
      abortRef.current = null;
      if (controller.signal.aborted) {
        // reset() already discarded the temp ZIP + cleared the ref.
        setPhase({ kind: "idle" });
        return;
      }
      const id = uploadIdRef.current;
      uploadIdRef.current = null;
      if (id) discardUpload(id); // clean the now-useless temp ZIP off disk
      setPhase({
        kind: "error",
        message: err instanceof Error ? err.message : "Nahrávání selhalo.",
      });
    }
  }, [discardUpload]);

  const confirm = useCallback(
    async (uploadId: string, fileName: string, onCollision: CollisionChoice) => {
      setPhase({ kind: "committing", fileName });
      try {
        const { summary, lsp } = await postJson<{
          ok: true;
          summary: ImportFileSummary;
          lsp: LspMergeResult | null;
        }>("/admin/api/import/commit", { uploadId, onCollision });
        uploadIdRef.current = null; // commit's finally already deleted the ZIP
        setPhase({ kind: "done", fileName, summary, lsp: lsp ?? null });
      } catch (err) {
        uploadIdRef.current = null; // ...deleted on failure too (idempotent retry)
        setPhase({
          kind: "error",
          message: err instanceof Error ? err.message : "Import selhal.",
        });
      }
    },
    [],
  );

  const onPick = (files: FileList | null) => {
    if (files && files.length > 0) void start(files[0]!);
  };

  // ── Render by phase ──────────────────────────────────────────────────────

  if (phase.kind === "uploading") {
    const pct = phase.total > 0 ? Math.round((phase.sent / phase.total) * 100) : 0;
    return (
      <Card>
        <Busy
          icon={CloudUpload}
          title="Nahrávám balíček…"
          subtitle={`${phase.fileName} — ${fmtBytes(phase.sent)} / ${fmtBytes(phase.total)}`}
        />
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-200">
          <div
            className="h-full rounded-full bg-brand-500 transition-[width]"
            style={{ width: `${Math.max(2, pct)}%` }}
          />
        </div>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            Zrušit
          </button>
        </div>
      </Card>
    );
  }

  if (phase.kind === "analyzing") {
    return (
      <Card>
        <Busy
          icon={Loader2}
          spin
          title="Analyzuji balíček…"
          subtitle={`${phase.fileName} — čtu obsah, nic se zatím nezapisuje`}
        />
      </Card>
    );
  }

  if (phase.kind === "review") {
    return (
      <ReviewCard
        plan={phase.plan}
        fileName={phase.fileName}
        collision={collision}
        onCollisionChange={setCollision}
        onConfirm={() =>
          void confirm(phase.uploadId, phase.fileName, collision)
        }
        onCancel={reset}
      />
    );
  }

  if (phase.kind === "committing") {
    return (
      <Card>
        <Busy
          icon={Loader2}
          spin
          title="Importuji…"
          subtitle={`${phase.fileName} — kopíruji soubory a slučuji metadata`}
        />
      </Card>
    );
  }

  if (phase.kind === "done") {
    return <DoneCard summary={phase.summary} lsp={phase.lsp} onReset={reset} />;
  }

  // idle + error share the dropzone; error shows a banner above it.
  return (
    <Card>
      {phase.kind === "error" && (
        <p className="mb-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{phase.message}</span>
        </p>
      )}
      <div
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          onPick(e.dataTransfer.files);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragActive) setDragActive(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragActive(false);
        }}
        className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-10 transition ${
          dragActive
            ? "border-brand-500 bg-brand-50/50"
            : "border-gray-300 bg-gray-50 hover:border-gray-400"
        }`}
      >
        <FileArchive className="h-9 w-9 text-gray-400" aria-hidden />
        <p className="text-sm text-gray-700">
          Přetáhni <strong>ZIP balíček pro web</strong> sem nebo{" "}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="font-medium text-brand-700 underline-offset-2 hover:underline"
          >
            vyber soubor
          </button>
        </p>
        <p className="text-xs text-gray-500">
          Očekávaná struktura: <code className="font-mono">finds/</code>{" "}
          <code className="font-mono">crops/</code>{" "}
          <code className="font-mono">maps/</code>{" "}
          <code className="font-mono">meta/LokaceStavyPoznamky.json</code>
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          onChange={(e) => {
            onPick(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
    </Card>
  );
}

// ── Review ───────────────────────────────────────────────────────────────

function ReviewCard({
  plan,
  fileName,
  collision,
  onCollisionChange,
  onConfirm,
  onCancel,
}: {
  plan: ImportPlan;
  fileName: string;
  collision: CollisionChoice;
  onCollisionChange: (c: CollisionChoice) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const nothing =
    plan.finds.total === 0 &&
    plan.crops.total === 0 &&
    plan.maps.total === 0 &&
    !plan.lsp.present;
  const replaceCount =
    plan.finds.replace + plan.crops.replace + plan.maps.replace;

  return (
    <Card>
      <header className="mb-3 flex items-center gap-2">
        <PackageOpen className="h-5 w-5 text-brand-600" aria-hidden />
        <div>
          <h2 className="text-sm font-semibold text-gray-900">
            Přehled balíčku
          </h2>
          <p className="truncate font-mono text-xs text-gray-500">{fileName}</p>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ScopeCard title="Originály nálezů" scope={plan.finds} />
        <ScopeCard title="Výřezy nálezů" scope={plan.crops} />
      </div>

      {/* Location maps — the actual list so the operator can verify each one */}
      <MapsSection maps={plan.maps} />

      {/* LSP metadata — same per-section diff the JSON editor shows */}
      <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <h3 className="text-xs font-semibold text-gray-800">
          Metadata (LokaceStavyPoznamky.json)
        </h3>
        {plan.lsp.present ? (
          <>
            <p className="mt-1 text-xs text-gray-500">
              V balíčku: lokace <strong>{plan.lsp.counts.lokace}</strong> · stavy{" "}
              <strong>{plan.lsp.counts.stavy}</strong> · poznámky{" "}
              <strong>{plan.lsp.counts.poznamky}</strong> · anonymizace{" "}
              <strong>{plan.lsp.counts.anon}</strong>
            </p>
            {plan.lsp.sections ? (
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <LspSectionCard label="anonymizace" diff={plan.lsp.sections.anonymizace} />
                <LspSectionCard label="stavy" diff={plan.lsp.sections.stavy} />
                <LspSectionCard label="poznámky" diff={plan.lsp.sections.poznamky} kind="keys" />
                <LspSectionCard label="lokace" diff={plan.lsp.sections.lokace} kind="both" />
              </div>
            ) : null}
          </>
        ) : (
          <p className="mt-1 text-xs text-gray-500">
            Balíček neobsahuje metadata — sloučí se jen soubory.
          </p>
        )}
        {plan.lsp.poznamkyConflicts.length > 0 && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-red-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              <strong>{plan.lsp.poznamkyConflicts.length}</strong>{" "}
              {conflictWord(plan.lsp.poznamkyConflicts.length)} v poznámkách
              (jiný text u stejného ID) — sloučení metadat se pak přeruší. ID:{" "}
              <IdRanges ids={plan.lsp.poznamkyConflicts} />
            </span>
          </p>
        )}
      </div>

      {/* Non-blocking observations */}
      {(plan.incompletePairs.length > 0 || plan.invalidNames.length > 0) && (
        <div className="mt-3 space-y-2">
          {plan.incompletePairs.length > 0 && (
            <Note tone="amber">
              <strong>{plan.incompletePairs.length}</strong>{" "}
              {pairWord(plan.incompletePairs.length)} má jen originál nebo
              jen výřez:{" "}
              <span className="font-mono">
                {plan.incompletePairs
                  .slice(0, 12)
                  .map((p) => `${p.findId}${p.has === "orig" ? " (bez výřezu)" : " (bez orig.)"}`)
                  .join(", ")}
                {plan.incompletePairs.length > 12 ? " …" : ""}
              </span>
            </Note>
          )}
          {plan.invalidNames.length > 0 && (
            <Note tone="amber">
              <strong>{plan.invalidNames.length}</strong> souborů s
              nerozpoznaným názvem se přeskočí:{" "}
              <span className="font-mono">
                {plan.invalidNames.slice(0, 6).join(", ")}
                {plan.invalidNames.length > 6 ? " …" : ""}
              </span>
            </Note>
          )}
        </div>
      )}

      {plan.warnings.map((w, i) => (
        <Note key={i} tone="amber">
          {w}
        </Note>
      ))}

      {/* Collision handling — only relevant when something already on the
          server would be touched. */}
      {replaceCount > 0 && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-semibold text-amber-900">
            Kolidující ID ({replaceCount} už na serveru)
          </p>
          <p className="mt-0.5 text-xs text-amber-800">
            Co s položkami, jejichž ID / MAP_ID už na serveru existuje? Nové se
            naimportují tak jako tak.
          </p>
          <div
            role="radiogroup"
            aria-label="Kolidující ID"
            className="mt-2 flex flex-col gap-1.5 sm:flex-row sm:gap-4"
          >
            <CollisionOption
              checked={collision === "overwrite"}
              onSelect={() => onCollisionChange("overwrite")}
              title="Přepsat"
              desc="starou verzi zálohovat do koše a nahrát novou"
            />
            <CollisionOption
              checked={collision === "skip"}
              onSelect={() => onCollisionChange("skip")}
              title="Přeskočit"
              desc="ponechat verzi na serveru, novou neimportovat"
            />
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <X className="h-4 w-4" aria-hidden />
          Zrušit
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={nothing}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <PackageOpen className="h-4 w-4" aria-hidden />
          Potvrdit import
        </button>
      </div>
    </Card>
  );
}

function CollisionOption({
  checked,
  onSelect,
  title,
  desc,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  desc: string;
}) {
  return (
    <label
      className={`flex flex-1 cursor-pointer flex-col gap-0.5 rounded-md border px-2.5 py-1.5 text-xs transition ${
        checked
          ? "border-amber-400 bg-white"
          : "border-amber-200 bg-amber-50/50 hover:border-amber-300"
      }`}
    >
      <span className="flex items-center gap-2 font-medium text-amber-900">
        <input
          type="radio"
          checked={checked}
          onChange={onSelect}
          className="accent-amber-600"
        />
        {title}
      </span>
      <span className="pl-6 text-amber-800">{desc}</span>
    </label>
  );
}

/** Compact monospace id list collapsed into ranges: "27273-27455, 27500".
 *  Contiguous runs become a single a-b span, so a package of 173 consecutive
 *  finds reads as one interval instead of 173 numbers. */
function IdRanges({ ids, maxRanges = 40 }: { ids: number[]; maxRanges?: number }) {
  if (ids.length === 0) return null;
  const ranges = compactToRanges(ids);
  const rest = ranges.length - Math.min(ranges.length, maxRanges);
  return (
    <span className="font-mono break-words">
      {ranges.slice(0, maxRanges).join(", ")}
      {rest > 0 ? ` … (+${rest} ${rest === 1 ? "úsek" : "úseků"})` : ""}
    </span>
  );
}

/** finds / crops card with the actual new + overwritten id lists so the
 *  operator can verify what the ZIP was read as. */
function ScopeCard({ title, scope }: { title: string; scope: ImportScopeStat }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {title}
        </h3>
        <span className="text-sm font-bold tabular-nums text-gray-900">
          {scope.total}
        </span>
      </div>
      {scope.total === 0 ? (
        <p className="mt-1 text-xs text-gray-400">Nic v balíčku.</p>
      ) : (
        <dl className="mt-1.5 space-y-1 text-xs">
          {scope.addIds.length > 0 && (
            <div>
              <dt className="text-emerald-700">+{scope.add} nových:</dt>
              <dd className="text-gray-600">
                <IdRanges ids={scope.addIds} />
              </dd>
            </div>
          )}
          {scope.replaceIds.length > 0 && (
            <div>
              <dt className="text-amber-700">↻ {scope.replace} přepis:</dt>
              <dd className="text-gray-600">
                <IdRanges ids={scope.replaceIds} />
              </dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}

/** Max map rows rendered before collapsing to a "+N dalších" note — keeps
 *  the DOM bounded on a pathologically large import. */
const MAP_ROWS_SHOWN = 100;

/** Location-maps detail — count summary + a per-map row list (MAP_ID, code,
 *  description, new/replace). */
function MapsSection({ maps }: { maps: ImportPlan["maps"] }) {
  const shown = maps.entries.slice(0, MAP_ROWS_SHOWN);
  const rest = maps.entries.length - shown.length;
  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Lokační mapy
        </h3>
        <span className="text-xs text-gray-600">
          {maps.total === 0 ? (
            "žádné"
          ) : (
            <>
              <span className="text-emerald-700">+{maps.add} nových</span>
              {maps.replace > 0 && (
                <>
                  {" · "}
                  <span className="text-amber-700">↻ {maps.replace} přepis</span>
                </>
              )}
            </>
          )}
        </span>
      </div>
      {shown.length > 0 && (
        <ul className="mt-2 divide-y divide-gray-100 overflow-hidden rounded-md border border-gray-100 text-xs">
          {shown.map((m) => (
            <MapRow key={`${m.mapId}+${m.fileName}`} entry={m} />
          ))}
        </ul>
      )}
      {rest > 0 && (
        <p className="mt-1 text-xs text-gray-400">…a {rest} dalších map</p>
      )}
    </div>
  );
}

function MapRow({ entry }: { entry: ImportMapEntry }) {
  return (
    <li className="flex items-center gap-2 px-2 py-1">
      <span className="font-mono tabular-nums text-gray-500">{entry.mapId}</span>
      <span
        className="min-w-0 flex-1 truncate text-gray-900"
        title={entry.fileName}
      >
        <span className="font-medium">{entry.locationCode}</span>
        {entry.description ? (
          <span className="text-gray-500"> — {entry.description}</span>
        ) : null}
      </span>
      <span
        className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
          entry.action === "add"
            ? "bg-emerald-100 text-emerald-800"
            : "bg-amber-100 text-amber-900"
        }`}
      >
        {entry.action === "add" ? "nová" : "přepis"}
      </span>
    </li>
  );
}

/** One LSP section's diff, mirroring the JSON editor's post-merge card:
 *  "Beze změny", or "Nové klíče: N (…)" / "Přidaných ID: N (…)". */
function LspSectionCard({
  label,
  diff,
  kind = "ids",
}: {
  label: string;
  diff: WholeFileMergeSectionDiff;
  /** which additions matter for this section: "ids" = range ids
   *  (anonymizace/stavy), "keys" = key additions (poznámky), "both" =
   *  new keys + ids (lokace). */
  kind?: "ids" | "keys" | "both";
}) {
  const showKeys = kind === "keys" || kind === "both";
  const showIds = kind === "ids" || kind === "both";
  const keyCount = diff.addedKeys.length;
  const idCount = diff.addedIds.length;
  const nothing = (!showKeys || keyCount === 0) && (!showIds || idCount === 0);
  return (
    <div className="rounded-md border border-gray-200 bg-white p-2">
      <p className="text-xs font-semibold text-gray-800">{label}</p>
      {nothing ? (
        <p className="mt-0.5 text-xs text-gray-400">Beze změny</p>
      ) : (
        <div className="mt-1 space-y-1 text-xs text-gray-600">
          {showKeys && keyCount > 0 && (
            <p>
              <span className="font-medium text-emerald-700">
                Nové klíče ({keyCount}):
              </span>{" "}
              <span className="font-mono break-words">
                {diff.addedKeys.slice(0, 30).join(", ")}
                {keyCount > 30 ? ` … (+${keyCount - 30})` : ""}
              </span>
            </p>
          )}
          {showIds && idCount > 0 && (
            <p>
              <span className="font-medium text-emerald-700">
                Přidaná ID ({idCount}):
              </span>{" "}
              <IdRanges ids={diff.addedIds} />
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Done ─────────────────────────────────────────────────────────────────

function DoneCard({
  summary,
  lsp,
  onReset,
}: {
  summary: ImportFileSummary;
  lsp: LspMergeResult | null;
  onReset: () => void;
}) {
  const totalErrors =
    summary.finds.errors +
    summary.crops.errors +
    summary.maps.errors +
    summary.errors.length;

  return (
    <Card>
      <header className="mb-3 flex items-center gap-2">
        <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden />
        <h2 className="text-sm font-semibold text-gray-900">Import dokončen</h2>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ResultCard title="Originály" res={summary.finds} />
        <ResultCard title="Výřezy" res={summary.crops} />
        <ResultCard title="Mapy" res={summary.maps} />
      </div>

      <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs">
        <h3 className="font-semibold text-gray-800">Metadata</h3>
        {lsp === null ? (
          <p className="mt-1 text-gray-500">Balíček neobsahoval metadata.</p>
        ) : lsp.ok ? (
          <p className="mt-1 text-emerald-700">
            {lsp.noChanges
              ? "Sloučeno — beze změn (nic nového)."
              : "Metadata sloučena do LokaceStavyPoznamky.json."}
          </p>
        ) : (
          <p className="mt-1 flex items-start gap-1.5 text-red-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              Sloučení metadat se nezdařilo
              {lsp.conflicts && lsp.conflicts.length > 0
                ? ` — ${lsp.conflicts.length} konfliktů v poznámkách`
                : lsp.error
                  ? `: ${lsp.error}`
                  : "."}{" "}
              Soubory jsou nahrané; oprav metadata v editoru a nahraj balíček
              znovu (soubory se jen přepíšou, nezduplikují).
            </span>
          </p>
        )}
      </div>

      {totalErrors > 0 && (
        <Note tone="red">
          {totalErrors} položek se nepodařilo zpracovat.
          {summary.errors.length > 0 && (
            <span className="mt-1 block font-mono text-[11px]">
              {summary.errors.slice(0, 5).join(" · ")}
              {summary.errors.length > 5 ? " …" : ""}
            </span>
          )}
        </Note>
      )}

      <div className="mt-4 rounded-lg border border-brand-200 bg-brand-50/50 p-3">
        <p className="text-xs text-gray-700">
          Soubory jsou nahrané na disk. Databázi a náhledy vytvoří až{" "}
          <strong>sync</strong> — spusť ho teď.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Link
            href="/admin/sync"
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700"
          >
            <Database className="h-4 w-4" aria-hidden />
            Přejít na Sync
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
            Nahrát další balíček
          </button>
        </div>
      </div>
    </Card>
  );
}

function ResultCard({
  title,
  res,
}: {
  title: string;
  res: { written: number; replaced: number; skipped: number; errors: number };
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        {title}
      </h3>
      <p className="mt-1 text-xs text-gray-700">
        <span className="text-emerald-700">{res.written} nových</span>
        {" · "}
        <span className="text-amber-700">{res.replaced} přepsáno</span>
        {res.skipped > 0 && (
          <>
            {" · "}
            <span className="text-gray-500">{res.skipped} přeskočeno</span>
          </>
        )}
        {res.errors > 0 && (
          <>
            {" · "}
            <span className="text-red-700">{res.errors} chyb</span>
          </>
        )}
      </p>
    </div>
  );
}

// ── Small shared bits ────────────────────────────────────────────────────

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      {children}
    </section>
  );
}

function Busy({
  icon: Icon,
  spin = false,
  title,
  subtitle,
}: {
  icon: typeof Loader2;
  spin?: boolean;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <Icon
        className={`h-6 w-6 shrink-0 text-brand-600 ${spin ? "animate-spin" : ""}`}
        aria-hidden
      />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-gray-900">{title}</p>
        <p className="truncate text-xs text-gray-500">{subtitle}</p>
      </div>
    </div>
  );
}

function Note({
  tone,
  children,
}: {
  tone: "amber" | "red";
  children: React.ReactNode;
}) {
  const cls =
    tone === "red"
      ? "border-red-200 bg-red-50 text-red-800"
      : "border-amber-200 bg-amber-50 text-amber-900";
  return (
    <p className={`mt-2 rounded-md border px-3 py-2 text-xs ${cls}`}>{children}</p>
  );
}

/** Czech plural for "konflikt" (1 / 2–4 / 5+). */
function conflictWord(n: number): string {
  if (n === 1) return "konflikt";
  if (n >= 2 && n <= 4) return "konflikty";
  return "konfliktů";
}

/** Czech plural for "nález" as subject of "má jen…". */
function pairWord(n: number): string {
  if (n === 1) return "nález";
  if (n >= 2 && n <= 4) return "nálezy";
  return "nálezů";
}
