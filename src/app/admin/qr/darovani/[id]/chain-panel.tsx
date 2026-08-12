"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  Link2,
  Loader2,
  Shuffle,
  TriangleAlert,
} from "lucide-react";
import { saveChainAction } from "../../drop-actions";
import { CONTROL_H_SM, Seg } from "../../qr-ui";
import { useRememberedOpen } from "../../use-remembered-open";
import type { ChainMode } from "@/lib/dropChain";

/**
 * "Řetězec čtyřlístků" — the hunt, set up per area.
 *
 * Whoever finds a chained card gets, on its landing page, a hint towards
 * the next one. So the chain is only as good as the hints: a card without
 * one is a dead end, and this panel says so before the cards are printed
 * rather than after somebody is standing in a park.
 *
 * Deliberately a section of its own rather than a column in Kusy — it is
 * set up once per wave, and the thing that matters is the ORDER, which a
 * grid of cards cannot show.
 */

const MODE_OPTS = [
  {
    v: "random",
    l: "Náhodně",
    title: "Pořadí se vylosuje — hledající neuhodne, kam ho řetěz pošle",
  },
  {
    v: "findId",
    l: "Podle čísla nálezu",
    title: "Od nejmenšího čísla k největšímu",
  },
];

export interface ChainItemView {
  id: number;
  findId: number;
  chainOrder: number | null;
  /** Has a hint of its own or inherits one from the wave. */
  hasHint: boolean;
}

export interface ChainAreaView {
  id: number;
  name: string;
  chainEnabled: boolean;
  items: ChainItemView[];
}

export function ChainPanel({
  campaignId,
  areas,
}: {
  campaignId: number;
  areas: ChainAreaView[];
}) {
  const chained = areas.filter((a) => a.chainEnabled).length;
  const [open, toggleOpen] = useRememberedOpen("drops.chain", false);

  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <button
        type="button"
        onClick={() => toggleOpen()}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-gray-900 transition hover:bg-gray-50"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 text-gray-400" aria-hidden />
        ) : (
          <ChevronRight className="h-4 w-4 text-gray-400" aria-hidden />
        )}
        <Link2 className="h-4 w-4 text-violet-500" aria-hidden />
        Řetězec čtyřlístků
        <span className="ml-1 font-normal text-xs text-gray-400">
          {chained === 0
            ? "vypnuto"
            : `zapnuto v ${chained} ${chained === 1 ? "oblasti" : "oblastech"}`}
        </span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-gray-100 p-4">
          <p className="rounded-lg border border-violet-200 bg-violet-50/70 px-3 py-2 text-[11px] leading-relaxed text-violet-900">
            Kdo najde kartičku z řetězu, uvidí na její stránce tlačítko
            s nápovědou k další. Prokliknout se řetězem od stolu nejde —
            nápověda se odkryje jen na stránce, ke které se člověk dostane
            naskenováním té předchozí kartičky. Ven jde <strong>text
            nápovědy</strong>, nikdy souřadnice ani odkaz.
          </p>

          {areas.length === 0 && (
            <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-4 text-center text-xs text-gray-500">
              Řetěz se skládá uvnitř oblasti — nejdřív přidej oblast.
            </p>
          )}

          {areas.map((a) => (
            <ChainArea key={a.id} campaignId={campaignId} area={a} />
          ))}
        </div>
      )}
    </section>
  );
}

function ChainArea({
  campaignId,
  area,
}: {
  campaignId: number;
  area: ChainAreaView;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(area.chainEnabled);
  const [mode, setMode] = useState<ChainMode>("random");
  const [picked, setPicked] = useState<Set<number>>(
    () => new Set(area.items.filter((i) => i.chainOrder !== null).map((i) => i.id)),
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, start] = useTransition();

  // `!= null`, not `!== null`: an undefined slipping through from a
  // partial query would otherwise read as "in the chain".
  const inChain = area.items
    .filter((i) => i.chainOrder != null)
    .sort((a, b) => a.chainOrder! - b.chainOrder!);
  // The last link has nobody to point at, so its hint is never read —
  // don't nag about it.
  const noHint = inChain.slice(0, -1).filter((i) => !i.hasHint);

  const save = (nextMode: ChainMode = mode) => {
    setError(null);
    setNotice(null);
    start(async () => {
      const r = await saveChainAction(campaignId, area.id, {
        enabled,
        itemIds: [...picked],
        mode: nextMode,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      // "o 3 kartičkách" / "o 7 kartičkách" — the locative plural is the
      // same for every count above one, so there is nothing to branch on.
      setNotice(
        r.ordered === 0
          ? "Řetěz je prázdný."
          : r.ordered === 1
            ? "Řetěz o jedné kartičce uložen — na řetěz je to ale krátké."
            : `Řetěz o ${r.ordered} kartičkách uložen.`,
      );
      router.refresh();
    });
  };

  const clear = () => {
    setEnabled(false);
    setPicked(new Set());
    setError(null);
    setNotice(null);
    start(async () => {
      const r = await saveChainAction(campaignId, area.id, {
        enabled: false,
        itemIds: [],
        mode: "findId",
      });
      if (!r.ok) setError(r.error);
      else {
        setNotice("Řetěz zrušen.");
        router.refresh();
      }
    });
  };

  const toggle = (id: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-gray-900">{area.name}</p>
        <span className="text-[11px] text-gray-500">
          {inChain.length > 0
            ? `${inChain.length} z ${area.items.length} v řetězu`
            : `${area.items.length} kusů, řetěz nesestavený`}
        </span>
        <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-xs text-gray-700">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
          />
          Zapnout řetěz
        </label>
      </div>

      {inChain.length > 0 && (
        <p className="flex flex-wrap items-center gap-1 rounded-md bg-white px-2.5 py-2 font-mono text-[11px] text-gray-700">
          {inChain.map((i, n) => (
            <span key={i.id} className="whitespace-nowrap">
              {n > 0 && <span className="mx-1 text-gray-300">→</span>}
              <span className={i.hasHint ? "" : "text-amber-700"}>
                #{i.findId}
              </span>
            </span>
          ))}
          <span className="ml-1 text-gray-400">· konec</span>
        </p>
      )}

      {noHint.length > 0 && (
        <p className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            Bez nápovědy, takže na nich řetěz utne:{" "}
            {noHint.map((i) => `#${i.findId}`).join(", ")}. Doplň ji u kusu
            nebo nastav výchozí nápovědu sady.
          </span>
        </p>
      )}

      <div>
        <p className="mb-1 text-[11px] font-medium text-gray-600">
          Které kartičky do řetězu
        </p>
        <ul className="flex flex-wrap gap-1.5">
          {area.items.map((i) => {
            const on = picked.has(i.id);
            return (
              <li key={i.id}>
                <button
                  type="button"
                  onClick={() => toggle(i.id)}
                  aria-pressed={on}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-mono text-[11px] transition ${
                    on
                      ? "border-violet-400 bg-violet-100 text-violet-900"
                      : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  #{i.findId}
                  {!i.hasHint && (
                    <span title="Nemá nápovědu" className="text-amber-600">
                      !
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        {area.items.length > 1 && (
          <div className="mt-1.5 flex gap-2 text-[11px]">
            <button
              type="button"
              onClick={() => setPicked(new Set(area.items.map((i) => i.id)))}
              className="text-gray-500 underline-offset-2 hover:underline"
            >
              Vybrat vše
            </button>
            <button
              type="button"
              onClick={() => setPicked(new Set())}
              className="text-gray-500 underline-offset-2 hover:underline"
            >
              Zrušit výběr
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Seg
          value={mode}
          onChange={(v) => setMode(v as ChainMode)}
          options={MODE_OPTS}
        />
        <button
          type="button"
          onClick={() => save()}
          disabled={busy}
          className={`${CONTROL_H_SM} inline-flex items-center gap-1.5 rounded-md border border-violet-300 bg-white px-2.5 text-xs font-medium text-violet-900 transition hover:bg-violet-50 disabled:opacity-50`}
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          Sestavit řetěz ({picked.size})
        </button>
        {inChain.length > 1 && (
          <button
            type="button"
            onClick={() => {
              setMode("random");
              save("random");
            }}
            disabled={busy}
            title="Vylosovat pořadí znovu — stejné kartičky, jiná cesta"
            className={`${CONTROL_H_SM} inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 text-xs text-gray-700 transition hover:bg-gray-50 disabled:opacity-50`}
          >
            <Shuffle className="h-3.5 w-3.5" aria-hidden />
            Promíchat
          </button>
        )}
        {inChain.length > 0 && (
          <button
            type="button"
            onClick={clear}
            disabled={busy}
            className={`${CONTROL_H_SM} inline-flex items-center rounded-md border border-gray-300 bg-white px-2.5 text-xs text-gray-500 transition hover:bg-gray-50 disabled:opacity-50`}
          >
            Zrušit řetěz
          </button>
        )}
      </div>

      {notice && (
        <p className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-900">
          {notice}
        </p>
      )}
      {error && (
        <p className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}
