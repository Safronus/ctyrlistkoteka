"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Download, Loader2, Upload } from "lucide-react";

/**
 * Download the CS source (via GET /admin/api/notes/export) and upload the
 * translated JSON (POST /admin/api/notes/import). The download is a plain
 * authenticated link; the upload reads the chosen file and posts its JSON
 * body, then refreshes so the "remaining" counts update.
 */
export function TranslationsClient({
  findsCount,
  mapsCount,
}: {
  findsCount: number;
  mapsCount: number;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, startTransition] = useTransition();
  const [result, setResult] = useState<{ finds: number; maps: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const onUpload = () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Nejdřív vyber přeložený .json soubor.");
      return;
    }
    setError(null);
    setResult(null);
    startTransition(async () => {
      try {
        const text = await file.text();
        JSON.parse(text); // fail fast with a readable client-side message
        const res = await fetch("/admin/api/notes/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: text,
          credentials: "same-origin",
        });
        const json = (await res.json()) as {
          ok?: boolean;
          finds?: number;
          maps?: number;
          error?: string;
        };
        if (!res.ok || !json.ok) {
          setError(json.error ?? `Chyba ${res.status}`);
          return;
        }
        setResult({ finds: json.finds ?? 0, maps: json.maps ?? 0 });
        if (fileRef.current) fileRef.current.value = "";
        setFileName(null);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Nahrání selhalo");
      }
    });
  };

  const total = findsCount + mapsCount;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm">
        <span className="text-gray-600">Bez anglického překladu zbývá: </span>
        <strong className="text-gray-900">{findsCount}</strong>
        <span className="text-gray-600"> poznámek nálezů + </span>
        <strong className="text-gray-900">{mapsCount}</strong>
        <span className="text-gray-600"> popisků map.</span>
        {total === 0 && (
          <span className="ml-1 font-medium text-brand-700">
            Vše přeloženo 🎉
          </span>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold text-gray-900">
          1. Stáhnout k překladu
        </h2>
        <p className="mb-3 text-xs text-gray-500">
          České zdrojové texty (jen ty bez EN varianty) jako JSON.
        </p>
        <a
          href="/admin/api/notes/export"
          download
          className="inline-flex items-center gap-1.5 rounded bg-gray-800 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-gray-900"
        >
          <Download className="h-4 w-4" aria-hidden />
          Stáhnout to-translate.json
        </a>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold text-gray-900">
          2. Nahrát přeložené
        </h2>
        <p className="mb-3 text-xs text-gray-500">
          Tvar <code>{`{ "finds": { "16230": "…" }, "maps": { "55": "…" } }`}</code>
          . Zapíše se jen <code>en</code>; existující ruční overridy zůstanou.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
            className="text-sm text-gray-600 file:mr-2 file:rounded file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-200"
          />
          <button
            type="button"
            onClick={onUpload}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Upload className="h-4 w-4" aria-hidden />
            )}
            Nahrát a zapsat
          </button>
        </div>
        {fileName && !result && !error && (
          <p className="mt-2 text-xs text-gray-500">Vybráno: {fileName}</p>
        )}
        {result && (
          <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700">
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            Zapsáno: {result.finds} poznámek nálezů, {result.maps} popisků map.
          </p>
        )}
        {error && (
          <p className="mt-2 whitespace-pre-wrap text-sm text-red-600">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
