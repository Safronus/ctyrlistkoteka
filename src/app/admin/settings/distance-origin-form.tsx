"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, Target } from "lucide-react";
import { setDistanceOriginAction } from "./actions";

export interface OriginChoice {
  id: number;
  code: string;
  displayName: string;
  finds: number;
}

/**
 * Picks the point every distance on the site is measured from.
 *
 * A dropdown of real locations rather than a number field: the value is a
 * location id, and typing one that doesn't exist would blank every
 * distance on the public site with nothing to explain it. Only locations
 * that actually have a centre are offered.
 */
export function DistanceOriginForm({
  current,
  choices,
}: {
  current: number;
  choices: OriginChoice[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(String(current));
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const dirty = Number(value) !== current;
  // A configured id that isn't in the list would make the <select> show
  // its FIRST option instead — and then "save" would silently repoint
  // distances at a location nobody chose. Say so and keep the value
  // selectable until it's deliberately changed.
  const missing = !choices.some((c) => c.id === current);

  return (
    <div className="space-y-2">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-700">
          Odkud se měří vzdálenost nálezů
        </span>
        <select
          className="w-full cursor-pointer rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setMsg(null);
            setError(null);
          }}
        >
          {missing && (
            <option value={current}>
              #{String(current).padStart(5, "0")} — lokalita v databázi není
            </option>
          )}
          {choices.map((c) => (
            <option key={c.id} value={c.id}>
              #{String(c.id).padStart(5, "0")} · {c.code}
              {c.displayName && c.displayName !== c.code
                ? ` — ${c.displayName}`
                : ""}
              {c.finds > 0 ? ` (${c.finds} nálezů)` : ""}
            </option>
          ))}
        </select>
      </label>
      <p className="text-[11px] text-gray-500">
        Střed téhle lokality je „doma“. Od něj se počítá vzdálenost u každého
        nálezu ve sbírce, na mapě i ve statistikách. Nic se nikam neukládá
        dopředu — čísla se počítají při každém zobrazení, takže změna se
        projeví hned.
      </p>

      {missing && (
        <p className="rounded border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
          Nastavená lokalita #{String(current).padStart(5, "0")} v databázi
          není — vzdálenosti se teď nepočítají. Vyber jinou, nebo ji doplň
          přes sync.
        </p>
      )}
      {error && (
        <p className="rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
          {error}
        </p>
      )}
      {msg && (
        <p className="rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-900">
          {msg}
        </p>
      )}

      <button
        type="button"
        disabled={busy || !dirty}
        onClick={() =>
          start(async () => {
            setError(null);
            setMsg(null);
            const r = await setDistanceOriginAction(Number(value));
            if (!r.ok) {
              setError(r.error);
              return;
            }
            setMsg(`Vzdálenosti se teď měří od ${r.label}.`);
            router.refresh();
          })
        }
        className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900 transition hover:bg-emerald-100 disabled:opacity-50"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : dirty ? (
          <Save className="h-4 w-4" aria-hidden />
        ) : (
          <Target className="h-4 w-4" aria-hidden />
        )}
        {dirty ? "Uložit bod měření" : "Beze změny"}
      </button>
    </div>
  );
}
