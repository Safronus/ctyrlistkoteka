"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CloudUpload,
  Loader2,
  RefreshCw,
  X,
  XCircle,
} from "lucide-react";
import { replaceMap } from "./replace-action";

interface Props {
  /** The on-disk name of the map being replaced. Sent to the server
   *  action via a hidden field — the dropped file's own name is
   *  intentionally ignored so the user can drop e.g. a renamed
   *  re-export without first having to match the filename by hand. */
  targetName: string;
}

const ACCEPT = ".png,.jpg,.jpeg";
const MAX_BYTES = 25 * 1024 * 1024;

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Single-file drag-drop on the map detail page — replaces the live
 *  map at the same on-disk name. Defaults to a confirm step before
 *  the actual upload because this is destructive (the previous bytes
 *  go to .trash, but it's still a one-way operation from the user's
 *  point of view). */
export function MapReplaceDropzone({ targetName }: Props) {
  const [staged, setStaged] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [resultOk, setResultOk] = useState<boolean | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [nameOverride, setNameOverride] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // NFC-aware name compare. macOS rsync delivers NFD on disk; the
  // browser's File.name often arrives in NFC. A byte-equal check
  // would warn on every diacritic'd filename even when the names
  // are visually identical.
  const nameMismatch =
    staged !== null &&
    staged.name.normalize("NFC") !== targetName.normalize("NFC");

  const handleFiles = useCallback((list: FileList | File[]) => {
    setResultOk(null);
    setResultMessage(null);
    setNameOverride(false);
    const files = Array.from(list);
    if (files.length === 0) return;
    if (files.length > 1) {
      setResultOk(false);
      setResultMessage(
        "Replace přijímá jen jeden soubor — vyber přesně jednu novou variantu mapy.",
      );
      return;
    }
    const f = files[0]!;
    if (f.size > MAX_BYTES) {
      setResultOk(false);
      setResultMessage(`Soubor je větší než ${fmtSize(MAX_BYTES)}`);
      return;
    }
    setStaged(f);
  }, []);

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  };
  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!dragActive) setDragActive(true);
  };
  const onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
  };

  const onSubmit = () => {
    if (!staged || isPending) return;
    if (nameMismatch && !nameOverride) {
      setResultOk(false);
      setResultMessage(
        "Název nového souboru se liší od cílového. Potvrď zaškrtnutím pod souborem, že to je záměr.",
      );
      return;
    }
    setResultOk(null);
    setResultMessage(null);
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.append("target", targetName);
        fd.append("file", staged);
        if (nameMismatch && nameOverride) {
          fd.append("nameOverride", "1");
        }
        const r = await replaceMap(fd);
        if (r.ok) {
          setResultOk(true);
          setResultMessage(
            `Přepsáno (${r.size !== undefined ? fmtSize(r.size) : "?"}). Stará verze leží v data/.trash/.`,
          );
          setStaged(null);
          setNameOverride(false);
          if (inputRef.current) inputRef.current.value = "";
        } else {
          setResultOk(false);
          setResultMessage(r.error ?? "Replace selhal");
        }
      } catch (err) {
        setResultOk(false);
        setResultMessage(
          err instanceof Error ? err.message : "Replace selhal",
        );
      }
    });
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <header className="mb-2 flex items-center gap-2">
        <RefreshCw className="h-4 w-4 text-brand-600" aria-hidden />
        <h2 className="text-sm font-semibold text-gray-900">
          Nahradit obsah mapy
        </h2>
      </header>
      <p className="mb-3 text-xs text-gray-500">
        Drag-drop přepíše soubor pod stejným názvem (
        <code className="font-mono break-all">{targetName}</code>). Stará
        verze se zazálohuje do <code className="font-mono">data/.trash/</code>
        . Akceptuje jeden PNG / JPEG.
      </p>

      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-5 transition ${
          dragActive
            ? "border-brand-500 bg-brand-50/50"
            : "border-gray-300 bg-gray-50 hover:border-gray-400"
        } ${isPending ? "pointer-events-none opacity-60" : ""}`}
      >
        <CloudUpload className="h-7 w-7 text-gray-400" aria-hidden />
        <p className="text-sm text-gray-700">
          Přetáhni nový PNG / JPEG sem nebo{" "}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="font-medium text-brand-700 underline-offset-2 hover:underline"
          >
            vyber soubor
          </button>
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              handleFiles(e.target.files);
              e.target.value = "";
            }
          }}
        />
      </div>

      {staged && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <CloudUpload className="h-4 w-4 shrink-0" aria-hidden />
            <span
              className="min-w-0 flex-1 truncate font-mono"
              title={staged.name}
            >
              {staged.name}
            </span>
            <span className="shrink-0 font-mono tabular-nums">
              {fmtSize(staged.size)}
            </span>
            <button
              type="button"
              onClick={() => {
                setStaged(null);
                setNameOverride(false);
              }}
              disabled={isPending}
              aria-label="Zahodit výběr"
              className="shrink-0 rounded p-0.5 text-amber-800 hover:bg-amber-100"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={isPending || (nameMismatch && !nameOverride)}
              className="inline-flex shrink-0 items-center gap-1 rounded bg-amber-600 px-2 py-0.5 font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending && (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              )}
              Nahradit
            </button>
          </div>

          {nameMismatch && (
            <div className="rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-900">
              <p className="mb-2 flex items-start gap-1.5 font-medium">
                <AlertTriangle
                  className="mt-0.5 h-3.5 w-3.5 shrink-0"
                  aria-hidden
                />
                <span>
                  Název nového souboru se neshoduje s cílovým. Mapa zůstane
                  uložená pod původním názvem (
                  <code className="font-mono break-all">{targetName}</code>),
                  ale parser z názvu bere{" "}
                  <code className="font-mono">locationCode</code>,{" "}
                  <code className="font-mono">GPS</code> a{" "}
                  <code className="font-mono">mapId</code> — pokud nový obsah
                  patří jinam, raději nahraj zvlášť.
                </span>
              </p>
              <label className="inline-flex items-start gap-2 leading-tight">
                <input
                  type="checkbox"
                  checked={nameOverride}
                  onChange={(e) => setNameOverride(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 rounded border-red-400 text-red-600 focus:ring-red-500"
                />
                <span>
                  Vím, co dělám — chci přepsat <em>{targetName}</em> obsahem
                  ze souboru s odlišným názvem.
                </span>
              </label>
            </div>
          )}
        </div>
      )}

      {resultMessage && (
        <p
          className={`mt-3 inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs ${
            resultOk
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {resultOk ? (
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <XCircle className="h-3.5 w-3.5" aria-hidden />
          )}
          {resultMessage}
        </p>
      )}
    </section>
  );
}
