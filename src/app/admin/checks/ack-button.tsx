"use client";

import { useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import { markCheckOk } from "./ack-action";

interface Props {
  checkId: string;
  offenderId: number;
}

/** Per-row "OK, tohle je v pořádku" button. Persists the ack into
 *  data/.admin/check-acks.json so the offender disappears on the
 *  next render. No undo control here — the JSON file is hand-
 *  editable, which is the right escape hatch for the (rare) case
 *  the user mis-acks a row. */
export function AckCheckButton({ checkId, offenderId }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const r = await markCheckOk(checkId, offenderId);
      if (!r.ok) setError(r.error);
      // On success the server action calls revalidatePath, the
      // server re-renders the page, and this whole row disappears
      // from the next snapshot — nothing to do on the client.
    });
  };

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={submit}
        disabled={isPending}
        title="Označit jako OK — řádek zmizí z kontroly"
        className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-white px-2 py-0.5 text-[11px] font-medium text-emerald-800 transition hover:border-emerald-400 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? (
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        ) : (
          <Check className="h-3 w-3" aria-hidden />
        )}
        OK
      </button>
      {error && (
        <span className="text-[10px] text-red-700" title={error}>
          {error.length > 24 ? `${error.slice(0, 24)}…` : error}
        </span>
      )}
    </span>
  );
}
