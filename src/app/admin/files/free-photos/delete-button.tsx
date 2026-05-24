"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { deleteFreePhoto } from "./delete-action";

interface Props {
  filename: string;
}

/** Two-step destructive control for a single free photo. */
export function DeleteFreePhotoButton({ filename }: Props) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 transition hover:border-red-300 hover:bg-red-50"
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
        Smazat
      </button>
    );
  }

  return (
    <form
      action={deleteFreePhoto}
      className="inline-flex shrink-0 items-center gap-2 rounded-md border border-red-300 bg-red-50 px-2.5 py-1.5 text-xs"
    >
      <input type="hidden" name="name" value={filename} />
      <span className="text-red-900">
        Přesunout do <code className="font-mono">.trash/</code>?
      </span>
      <button
        type="submit"
        className="rounded bg-red-600 px-2 py-0.5 font-medium text-white hover:bg-red-700"
      >
        Ano, smazat
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="rounded border border-gray-300 bg-white px-2 py-0.5 font-medium text-gray-700 hover:bg-gray-50"
      >
        Zrušit
      </button>
    </form>
  );
}
