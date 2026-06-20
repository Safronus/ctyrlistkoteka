"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { addDonatedFind, removeDonatedFind } from "./donated-actions";

export function DonatedBoardForm({ ids }: { ids: number[] }) {
  const router = useRouter();
  const [findId, setFindId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();

  const onAdd = () => {
    setError(null);
    const id = Number(findId.trim());
    if (!Number.isInteger(id) || id <= 0) {
      setError("Zadej platné kladné číslo nálezu.");
      return;
    }
    startBusy(async () => {
      const res = await addDonatedFind(id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setFindId("");
      router.refresh();
    });
  };

  const onRemove = (id: number) => {
    setError(null);
    startBusy(async () => {
      const res = await removeDonatedFind(id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="space-y-5">
      {/* Add */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">
          Přidat rozdaný čtyřlístek
        </h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-700">
              Číslo nálezu (musí být „Darovaný“)
            </span>
            <input
              type="number"
              min={1}
              inputMode="numeric"
              value={findId}
              onChange={(e) => setFindId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onAdd();
                }
              }}
              placeholder="16230"
              className="w-40 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </label>
          <button
            type="button"
            onClick={onAdd}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Plus className="h-4 w-4" aria-hidden />
            )}
            Přidat
          </button>
        </div>
        {error && (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        )}
      </div>

      {/* Current list */}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-gray-900">
          Aktuální seznam ({ids.length})
        </h2>
        {ids.length === 0 ? (
          <p className="text-sm text-gray-500">
            Zatím tu není žádný rozdaný čtyřlístek.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {ids.map((id) => (
              <li
                key={id}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5"
              >
                <a
                  href={`/sbirka/${id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-sm font-semibold text-brand-700 hover:underline"
                >
                  #{id}
                </a>
                <button
                  type="button"
                  onClick={() => onRemove(id)}
                  disabled={busy}
                  title="Odebrat ze seznamu"
                  aria-label={`Odebrat nález #${id} ze seznamu`}
                  className="inline-flex items-center rounded-md border border-gray-300 p-1 text-gray-500 transition hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
