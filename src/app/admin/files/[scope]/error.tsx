"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";

/** Error boundary for /admin/files/<scope> listings. Captures render
 *  errors that would otherwise blow up as the masked Next.js
 *  production "Server Components render" wrapper, and surfaces the
 *  digest so the operator can grep PM2 logs for the actual cause. */
export default function ScopeListingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Best-effort client-side breadcrumb. The real stack lives in the
    // server log keyed by `error.digest`.
    console.error("[admin/files-listing] render error", {
      message: error.message,
      digest: error.digest,
    });
  }, [error]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <AlertTriangle className="h-4 w-4 text-red-700" aria-hidden />
          Listing souborů selhal při renderu
        </h2>
        <p className="mt-1 text-xs">
          Něco shořelo na server-side renderu téhle stránky. Soubory na
          disku tím nejsou ovlivněné — refreshni nebo se vrať a zkus to
          znovu.
        </p>
        {error.digest && (
          <p className="mt-2 text-xs">
            Server digest:{" "}
            <code className="rounded bg-red-100 px-1 py-0.5 font-mono">
              {error.digest}
            </code>
            <span className="ml-2 text-red-800/70">
              {`(v Termiusu: pm2 logs ctyrlistkoteka --err --lines 500 | grep '${error.digest}')`}
            </span>
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-800 hover:border-red-400 hover:bg-red-50"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            Zkusit znovu
          </button>
          <Link
            href="/admin/files"
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:border-gray-400 hover:bg-gray-50"
          >
            Zpět na přehled
          </Link>
        </div>
      </div>
    </div>
  );
}
