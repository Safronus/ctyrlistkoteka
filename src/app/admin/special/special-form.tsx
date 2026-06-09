"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import {
  SPECIAL_EFFECTS,
  SPECIAL_EFFECT_LABELS,
  type SpecialEffect,
  type SpecialFind,
} from "@/lib/specialFinds";
import { addSpecialFind, removeSpecialFind } from "./special-actions";

export function SpecialFindsForm({ items }: { items: SpecialFind[] }) {
  const router = useRouter();
  const [findId, setFindId] = useState("");
  const [effect, setEffect] = useState<SpecialEffect>("record");
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
      const res = await addSpecialFind(id, effect);
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
      const res = await removeSpecialFind(id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="space-y-5">
      {/* Add / re-assign */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">
          Přiřadit efekt
        </h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-700">
              Číslo nálezu
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
              placeholder="20037"
              className="w-32 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-700">
              Efekt
            </span>
            <select
              value={effect}
              onChange={(e) => setEffect(e.target.value as SpecialEffect)}
              className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            >
              {SPECIAL_EFFECTS.map((value) => (
                <option key={value} value={value}>
                  {SPECIAL_EFFECT_LABELS[value]}
                </option>
              ))}
            </select>
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

      {/* Current assignments */}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-gray-900">
          Aktuální přiřazení ({items.length})
        </h2>
        {items.length === 0 ? (
          <p className="text-sm text-gray-500">
            Zatím nemá žádný nález speciální efekt.
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => (
              <li
                key={item.findId}
                className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2"
              >
                <div className="min-w-0">
                  <a
                    href={`/sbirka/${item.findId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-sm font-semibold text-brand-700 hover:underline"
                  >
                    #{item.findId}
                  </a>
                  <span className="ml-2 text-xs text-gray-600">
                    {SPECIAL_EFFECT_LABELS[item.effect]}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(item.findId)}
                  disabled={busy}
                  title="Odebrat efekt"
                  aria-label={`Odebrat efekt nálezu #${item.findId}`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 transition hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  Smazat
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
