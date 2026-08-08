"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CircleCheck,
  ExternalLink,
  HelpCircle,
  Link2,
  Loader2,
  RefreshCw,
  Table2,
} from "lucide-react";
import {
  saveSheetUrlAction,
  previewSheetSyncAction,
  applySheetSyncAction,
  setSheetModeAction,
  type ImportReport,
  type SheetStatus,
} from "../../drop-actions";
import type { DropChange } from "@/lib/admin/dropPlan";
import { CONTROL_H, INPUT_CLS } from "../../qr-ui";

/**
 * The wave's Google Sheet: the link, what state it is in, and the pull.
 *
 * One direction only — the sheet is read, never written. Two-way sync was
 * considered and dropped: neither side records per-field change times, so
 * "whose edit is newer" is unanswerable, and a wrong answer eats somebody's
 * afternoon silently. See docs/admin-overview.md.
 *
 * Nothing is applied without being shown first. The preview is the point.
 */
export function SheetPanel({
  campaignId,
  status,
}: {
  campaignId: number;
  status: SheetStatus;
}) {
  const router = useRouter();
  const [url, setUrl] = useState(status.url ?? "");
  const [preview, setPreview] = useState<{
    changes: DropChange[];
    report: ImportReport;
    unchanged: boolean;
    fatal: boolean;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(!status.url);
  const [busy, start] = useTransition();

  const linkDirty = url.trim() !== (status.url ?? "");

  const saveUrl = () =>
    start(async () => {
      setError(null);
      setNotice(null);
      setPreview(null);
      const r = await saveSheetUrlAction(campaignId, url);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setUrl(r.url ?? "");
      setNotice(
        r.url
          ? "Odkaz uložen a tabulka je čitelná."
          : "Odkaz odpojen. Sada se spravuje jen v adminu.",
      );
      router.refresh();
    });

  const check = () =>
    start(async () => {
      setError(null);
      setNotice(null);
      const r = await previewSheetSyncAction(campaignId);
      if (!r.ok) {
        setError(r.error);
        setPreview(null);
        return;
      }
      setPreview(r);
      router.refresh();
    });

  const apply = () =>
    start(async () => {
      setError(null);
      const r = await applySheetSyncAction(campaignId);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setPreview(null);
      setNotice(
        r.report.changed > 0
          ? `Použito: ${r.report.changed} kusů změněno.`
          : "Hotovo — nebylo co měnit.",
      );
      router.refresh();
    });

  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Table2 className="h-4 w-4 text-emerald-600" aria-hidden />
          Google Sheets
          {status.error && (
            <span className="inline-flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-900">
              <AlertTriangle className="h-3 w-3" aria-hidden />
              problém
            </span>
          )}
        </h2>
        <button
          type="button"
          onClick={() => setShowHelp((h) => !h)}
          className="inline-flex items-center gap-1 text-[11px] text-gray-500 underline-offset-2 hover:text-gray-800 hover:underline"
        >
          <HelpCircle className="h-3.5 w-3.5" aria-hidden />
          {showHelp ? "Skrýt návod" : "Návod"}
        </button>
      </div>

      <p className="text-xs text-gray-500">
        Tabulka se z odkazu <strong>jen čte</strong>. Zpátky do ní se nikdy
        nezapisuje — co změníš v adminu, do Sheets samo nedojde.
      </p>

      {showHelp && <Help />}

      {/* ------------------------------------------------------ the link */}
      <div className="grid items-start gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-700">
            Odkaz na tabulku
          </span>
          <input
            className={`${INPUT_CLS} ${CONTROL_H} font-mono text-xs`}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/…"
          />
        </label>
        <button
          type="button"
          onClick={saveUrl}
          disabled={busy || !linkDirty}
          className={`mt-5 ${CONTROL_H} inline-flex items-center gap-1.5 self-start rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50`}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Link2 className="h-4 w-4" aria-hidden />
          )}
          {url.trim() ? "Uložit odkaz" : "Odpojit"}
        </button>
      </div>

      {/* ---------------------------------------------------- the status */}
      {status.url && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[11px]">
          <a
            href={status.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-brand-700 hover:underline"
          >
            <ExternalLink className="h-3 w-3" aria-hidden />
            otevřít tabulku
          </a>
          <span className="text-gray-500">
            Naposled zkontrolováno:{" "}
            <strong className="text-gray-800">
              {status.syncedAt ? fmt(status.syncedAt) : "nikdy"}
            </strong>
          </span>
          <span className="text-gray-500">
            Naposled se změnila:{" "}
            <strong className="text-gray-800">
              {status.changedAt ? fmt(status.changedAt) : "—"}
            </strong>
          </span>
        </div>
      )}

      {status.url && (
        <div
          className={`rounded-lg border px-3 py-2 ${
            status.mode
              ? "border-emerald-300 bg-emerald-50"
              : "border-gray-200 bg-gray-50"
          }`}
        >
          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              checked={status.mode}
              disabled={busy}
              onChange={(e) =>
                start(async () => {
                  setError(null);
                  const r = await setSheetModeAction(
                    campaignId,
                    e.target.checked,
                  );
                  if (!r.ok) setError(r.error);
                  router.refresh();
                })
              }
              aria-label="Režim tabulky — tabulka má pravdu"
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500/30"
            />
            <span>
              <span className="block text-xs font-semibold text-gray-900">
                Režim tabulky — tabulka má pravdu
              </span>
              <span className="mt-0.5 block text-[11px] text-gray-600">
                {status.mode ? (
                  <>
                    Texty, nápovědy, stav, GPS, kdo umísťuje a poznámka jsou
                    v adminu <strong>jen ke čtení</strong> a klikání do mapy
                    i Rozhodit je vypnuté. Mění se to v tabulce.
                  </>
                ) : (
                  <>
                    Zapni, až budeš mít sadu naplánovanou a rozhozenou. Od té
                    chvíle se kusy mění výhradně v tabulce — admin je přestane
                    pouštět, aby ti je příští synchronizace nepřepsala pod
                    rukama.
                  </>
                )}
              </span>
            </span>
          </label>
        </div>
      )}

      {status.error && (
        <p className="flex items-start gap-2 rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            Poslední pokus selhal: {status.error}
          </span>
        </p>
      )}

      {status.url && (
        <button
          type="button"
          onClick={check}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900 transition hover:bg-emerald-100 disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="h-4 w-4" aria-hidden />
          )}
          Zkontrolovat změny
        </button>
      )}

      {error && (
        <p className="rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-900">
          {notice}
        </p>
      )}

      {preview && <Preview preview={preview} busy={busy} onApply={apply} />}
    </section>
  );
}

function Preview({
  preview,
  busy,
  onApply,
}: {
  preview: {
    changes: DropChange[];
    report: ImportReport;
    unchanged: boolean;
    fatal: boolean;
  };
  busy: boolean;
  onApply: () => void;
}) {
  const { changes, report } = preview;

  if (preview.fatal) {
    return (
      <div className="space-y-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
        <p className="font-medium">
          Z tabulky se nedalo přečíst nic:
        </p>
        <ul className="list-disc space-y-0.5 pl-4">
          {report.errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      </div>
    );
  }

  if (changes.length === 0) {
    return (
      <div className="space-y-2">
        <p className="inline-flex items-center gap-1.5 rounded border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs text-gray-600">
          <CircleCheck className="h-4 w-4 text-emerald-600" aria-hidden />
          Tabulka odpovídá tomu, co je v adminu. Není co měnit.
        </p>
        <Warnings report={report} />
      </div>
    );
  }

  // Grouped by card: "what happens to #30042" is the question, not
  // "which fields changed across the wave".
  const byFind = new Map<number, DropChange[]>();
  for (const c of changes) {
    const list = byFind.get(c.findId) ?? [];
    list.push(c);
    byFind.set(c.findId, list);
  }

  return (
    <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
      <p className="text-xs font-medium text-amber-900">
        Změní se {byFind.size} {plural(byFind.size, "kus", "kusy", "kusů")} ·{" "}
        {changes.length} {plural(changes.length, "pole", "pole", "polí")}
      </p>

      <ul className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
        {[...byFind.entries()].map(([findId, list]) => (
          <li
            key={findId}
            className="rounded-md border border-amber-200 bg-white px-2.5 py-1.5"
          >
            <p className="text-xs font-semibold text-gray-900">🍀 #{findId}</p>
            <ul className="mt-0.5 space-y-0.5">
              {list.map((c, i) => (
                <li key={i} className="text-[11px] leading-relaxed">
                  <span className="text-gray-500">{c.field}: </span>
                  <span className="text-red-700 line-through">{c.before}</span>
                  <span className="text-gray-400"> → </span>
                  <span className="text-emerald-800">{c.after}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      <Warnings report={report} />

      <button
        type="button"
        onClick={onApply}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900 transition hover:bg-emerald-100 disabled:opacity-50"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <CircleCheck className="h-4 w-4" aria-hidden />
        )}
        Použít změny
      </button>
      <p className="text-[11px] text-amber-800">
        Tabulka se před použitím načte znovu — kdyby se mezitím změnila,
        použije se ta novější verze.
      </p>
    </div>
  );
}

function Warnings({ report }: { report: ImportReport }) {
  const bits: string[] = [];
  // Row-level complaints: those cells were left alone, the rest went in.
  const skipped = report.errors;
  if (report.unknownFinds.length > 0) {
    bits.push(
      `${report.unknownFinds.length} čísel v sadě není: ${report.unknownFinds.slice(0, 8).join(", ")}${report.unknownFinds.length > 8 ? "…" : ""}`,
    );
  }
  if (report.unknownAreas.length > 0) {
    bits.push(`neznámé oblasti: ${report.unknownAreas.join(", ")}`);
  }
  if (report.unknownPlacers.length > 0) {
    bits.push(`jména mimo tým: ${report.unknownPlacers.join(", ")}`);
  }
  if (
    bits.length === 0 &&
    report.staleFields.length === 0 &&
    skipped.length === 0
  ) {
    return null;
  }

  return (
    <div className="space-y-1 text-[11px]">
      {skipped.length > 0 && (
        <div className="rounded border border-amber-300 bg-amber-100 px-2 py-1 text-amber-900">
          <p className="font-medium">
            Přeskočeno {skipped.length}{" "}
            {plural(skipped.length, "políčko", "políčka", "políček")} — zbytek
            se použije:
          </p>
          <ul className="list-disc space-y-0.5 pl-4">
            {skipped.slice(0, 12).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {bits.map((b, i) => (
        <p key={i} className="text-amber-800">
          {b}
        </p>
      ))}
      {report.staleFields.length > 0 && (
        <p className="rounded border border-amber-300 bg-amber-100 px-2 py-1 text-amber-900">
          <strong>Tabulka je starší než texty sady.</strong> Pole{" "}
          {report.staleFields.join(", ")} nesou verzi, která se mezitím
          v adminu změnila — přeskočila se, aby ti tvou úpravu nepřepsala.
          Stáhni nový export a nahraď obsah tabulky.
        </p>
      )}
    </div>
  );
}

function Help() {
  return (
    <div className="space-y-2 rounded-lg border border-sky-200 bg-sky-50/60 p-3 text-[11px] leading-relaxed text-gray-700">
      <p className="text-xs font-semibold text-gray-900">
        Jak tabulku založit
      </p>
      <ol className="list-decimal space-y-1 pl-4">
        <li>
          Nahoře v sekci <strong>Tabulka (xlsx)</strong> stáhni aktuální
          export.
        </li>
        <li>
          Nahraj ho na Google Drive a otevři — Drive nabídne{" "}
          <strong>převod na Google Sheets</strong>. Ten je potřeba, z
          nahraného .xlsx se číst nedá.
        </li>
        <li>
          Sdílení nastav na <strong>„Kdokoli s odkazem: Čtenář“</strong>.
          Synchronizace víc nepotřebuje. Komu chceš dát psaní, přidej ho
          jmenovitě jako Editora.
        </li>
        <li>
          Jednou doklikej ochranu:{" "}
          <em>Data → Chránit listy a rozsahy → celý list → Kromě určitých
          buněk</em>, režim <strong>Zobrazit upozornění</strong>. Zabrání to
          nedopatřením, ne úmyslu.
        </li>
        <li>Zkopíruj odkaz z prohlížeče sem nahoru a ulož.</li>
      </ol>

      <p className="pt-1 text-xs font-semibold text-gray-900">
        Jak tabulku aktualizovat, když přibude sloupec nebo kus
      </p>
      <p>
        Stáhni nový export a v Sheets použij{" "}
        <em>Soubor → Importovat → Nahrát → Nahradit aktuální list</em>.
        Zůstane ti <strong>stejný odkaz i sdílení</strong>, vymění se jen
        obsah. Zakládat novou tabulku není potřeba — jen bys musel znovu
        rozesílat odkaz. Po importu zkontroluj ochranu z kroku 4, umí ji
        shodit.
      </p>

      <p className="pt-1 text-xs font-semibold text-gray-900">
        Co v tabulce platí
      </p>
      <ul className="list-disc space-y-0.5 pl-4">
        <li>
          List se musí jmenovat <strong>Kusy</strong> a hlavička musí zůstat.
        </li>
        <li>
          <strong>Číslo čtyřlístku je klíč.</strong> Řádky se podle něj
          párují, takže je můžete libovolně řadit.
        </li>
        <li>Smazaný řádek nic nesmaže, přidaný řádek nic nezaloží.</li>
        <li>
          Prázdná buňka u textu = převzít ze sady. Hodnota shodná se sadou
          znamená, že kus sadu dál sleduje.
        </li>
        <li>GPS piš jako text, formát buňky neměň na číslo.</li>
        <li>Vysvětlivky jsou i v tabulce — na listu Návod a pod daty.</li>
      </ul>

      <p className="pt-1 rounded border border-amber-300 bg-amber-100 px-2 py-1 text-amber-900">
        <strong>Pozor:</strong> tabulka obsahuje souřadnice všech úkrytů.
        Kdo dostane odkaz, má je taky.
      </p>
    </div>
  );
}

/** Czech counts three ways: one, a few, many. */
function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  return n >= 2 && n <= 4 ? few : many;
}

const stampFmt = new Intl.DateTimeFormat("cs-CZ", {
  day: "numeric",
  month: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function fmt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : stampFmt.format(d);
}
