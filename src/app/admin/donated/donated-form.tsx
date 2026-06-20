"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { DONATED_BOARD_MIN_FIND_ID } from "@/lib/donatedBoard";
import { setDonatedFind } from "./donated-actions";

interface Item {
  id: number;
  foundAt: string | null;
  onBoard: boolean;
}

// Admin is CZ-only; found_at is the naive Prague wall-clock stored as a
// UTC instant, so render it verbatim (no timeZone) like the rest of the
// site does.
const dateFmt = new Intl.DateTimeFormat("cs-CZ", {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function DonatedBoardForm({ items }: { items: Item[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [busy, startBusy] = useTransition();

  const onToggle = (id: number, next: boolean) => {
    setError(null);
    setPendingId(id);
    startBusy(async () => {
      const res = await setDonatedFind(id, next);
      if (!res.ok) {
        setError(res.error);
        setPendingId(null);
        return;
      }
      router.refresh();
      setPendingId(null);
    });
  };

  if (items.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        Zatím nejsou žádné nálezy se stavem „Darovaný“ od #
        {DONATED_BOARD_MIN_FIND_ID} výš.
      </p>
    );
  }

  const onCount = items.filter((i) => i.onBoard).length;

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        Na poli: <strong className="font-semibold">{onCount}</strong> z{" "}
        {items.length} darovaných
      </p>
      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}
      <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
        {items.map((it) => {
          const pending = busy && pendingId === it.id;
          return (
            <li
              key={it.id}
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <div className="min-w-0">
                <a
                  href={`/sbirka/${it.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-sm font-semibold text-brand-700 hover:underline"
                >
                  #{it.id}
                </a>
                {it.foundAt && (
                  <span className="ml-2 text-xs text-gray-500">
                    {dateFmt.format(new Date(it.foundAt))}
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {pending && (
                  <Loader2
                    className="h-4 w-4 animate-spin text-gray-400"
                    aria-hidden
                  />
                )}
                <button
                  type="button"
                  role="switch"
                  aria-checked={it.onBoard}
                  aria-label={
                    it.onBoard
                      ? `Odebrat nález #${it.id} z pole`
                      : `Přidat nález #${it.id} na pole`
                  }
                  disabled={busy}
                  onClick={() => onToggle(it.id, !it.onBoard)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition disabled:opacity-60 ${
                    it.onBoard ? "bg-brand-600" : "bg-gray-300"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                      it.onBoard ? "translate-x-5" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
