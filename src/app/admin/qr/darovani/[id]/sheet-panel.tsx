"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  ExternalLink,
  HelpCircle,
  Link2,
  Loader2,
  RefreshCw,
  ServerCog,
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
import { useRememberedOpen } from "../../use-remembered-open";

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
  const [showServer, setShowServer] = useState(false);
  const [open, toggleOpen] = useRememberedOpen("drops.sheet", true);
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
        <button
          type="button"
          onClick={toggleOpen}
          aria-expanded={open}
          className="flex items-center gap-2 text-left text-sm font-semibold text-gray-900"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 text-gray-400" aria-hidden />
          ) : (
            <ChevronRight className="h-4 w-4 text-gray-400" aria-hidden />
          )}
          <Table2 className="h-4 w-4 text-emerald-600" aria-hidden />
          Google Sheets
          {status.error && (
            <span className="inline-flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-900">
              <AlertTriangle className="h-3 w-3" aria-hidden />
              problém
            </span>
          )}
        </button>
        {open && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowHelp((h) => !h)}
            className="inline-flex items-center gap-1 text-[11px] text-gray-500 underline-offset-2 hover:text-gray-800 hover:underline"
          >
            <HelpCircle className="h-3.5 w-3.5" aria-hidden />
            {showHelp ? "Skrýt návod" : "Návod k tabulce"}
          </button>
          <button
            type="button"
            onClick={() => setShowServer((h) => !h)}
            className="inline-flex items-center gap-1 text-[11px] text-gray-500 underline-offset-2 hover:text-gray-800 hover:underline"
          >
            <ServerCog className="h-3.5 w-3.5" aria-hidden />
            {showServer ? "Skrýt" : "Zapnout automatiku na serveru"}
          </button>
        </div>
        )}
      </div>

      {open && (
      <>

      <p className="text-xs text-gray-500">
        Tabulka se z odkazu <strong>jen čte</strong>. Zpátky do ní se nikdy
        nezapisuje — co změníš v adminu, do Sheets samo nedojde.
      </p>

      {showHelp && <Help />}
      {showServer && <ServerHelp />}

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
          {status.mode && <NextSyncCountdown syncedAt={status.syncedAt} />}
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

      {/* Both the button and the timer stamp `syncedAt`, so a mode-run
          wave that has not been checked in a while means neither has run
          — which is exactly the state after switching the mode on and
          forgetting the server half. */}
      {status.mode && staleSync(status.syncedAt) && (
        <p className="rounded border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-xs text-violet-900">
          Režim tabulky běží, ale{" "}
          {status.syncedAt
            ? "poslední kontrola je starší než 20 minut"
            : "tabulka ještě nebyla ani jednou zkontrolována"}
          . Automatika na serveru nejspíš není zapnutá — návod je nahoře pod{" "}
          <strong>„Zapnout automatiku na serveru“</strong>. Do té doby stahuj
          ručně tlačítkem níž.
        </p>
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
      </>
      )}
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

/** Roughly four missed five-minute ticks — long enough not to cry wolf
 *  over one slow run, short enough to notice the same afternoon. */
/** How often the systemd timer pulls — `OnUnitActiveSec=5min` in
 *  `deploy/drop-sheet-sync.timer`. Change one, change the other. */
const SYNC_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Counts down to the next expected pull.
 *
 * It is an ESTIMATE and says so, because the app cannot see systemd's
 * schedule: `syncedAt` is stamped on every check (unchanged, changed and
 * failed alike), and the timer fires 5 minutes after the previous run
 * finished — so "last check + 5 min" is the best the app can honestly
 * know. When that moment passes without a new check, the countdown says
 * the pull is overdue rather than counting into negative numbers, and
 * the stale-sync warning below takes over from 20 minutes.
 */
function NextSyncCountdown({ syncedAt }: { syncedAt: string | null }) {
  // `null` until mounted, on purpose: the server has no idea what time it
  // is on the operator's machine, so rendering a countdown into the HTML
  // would ship a number that is already wrong and mismatch on hydration.
  // The one extra render that costs is the whole point of the pattern —
  // it happens once, on mount, and never cascades.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!syncedAt || now === null) return null;
  const last = new Date(syncedAt).getTime();
  if (Number.isNaN(last)) return null;

  const remaining = last + SYNC_INTERVAL_MS - now;
  return (
    <span className="text-gray-500">
      Další kontrola:{" "}
      <strong className={remaining > 0 ? "text-gray-800" : "text-amber-700"}>
        {remaining > 0 ? `za ${mmss(remaining)}` : "měla už proběhnout"}
      </strong>
    </span>
  );
}

/** `m:ss` for a positive duration in milliseconds. */
function mmss(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

const STALE_SYNC_MS = 20 * 60 * 1000;

function staleSync(syncedAt: string | null): boolean {
  if (!syncedAt) return true;
  const t = new Date(syncedAt).getTime();
  return Number.isNaN(t) || Date.now() - t > STALE_SYNC_MS;
}

/** Czech counts three ways: one, a few, many. */
function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  return n >= 2 && n <= 4 ? few : many;
}

/**
 * How to switch the timer on. Kept in the admin rather than only in
 * deploy/README.md because that is where somebody stands when they decide
 * to do it — and because it is the one part of this feature that lives on
 * the server and cannot be clicked.
 */
function ServerHelp() {
  return (
    <div className="space-y-2 rounded-lg border border-violet-200 bg-violet-50/60 p-3 text-[11px] leading-relaxed text-gray-700">
      <p className="text-xs font-semibold text-gray-900">
        Automatická synchronizace každých 5 minut
      </p>
      <p>
        Tlačítko <em>Zkontrolovat změny</em> funguje vždycky. Tohle je navíc
        — timer na serveru, který tabulku stahuje sám. Dokud ho nezapneš,
        endpoint <code className="rounded bg-white px-1">/api/admin/drops/sync</code>{" "}
        vrací 404 a <strong>nic se neděje</strong>; to je v pořádku, ne chyba.
      </p>

      <p className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-emerald-900">
        <strong>Kód už na serveru je.</strong> Push do <code>main</code> spustí
        GitHub runner přímo na VPS, který sám udělá install, migrace, build a{" "}
        <code>pm2 reload</code> — včetně unit souborů níž. Nic netahej ručně,
        ruční build závodí s runnerem.
      </p>

      <p className="pt-1 font-semibold text-gray-900">
        Postup v Termiusu — jen tyhle kroky jsou opravdu ruční
      </p>
      <ol className="list-decimal space-y-1.5 pl-4">
        <li>
          Zkopírovat unit soubory z repozitáře:
          <Cmd>sudo cp deploy/drop-sheet-sync.&#123;service,timer&#125; /etc/systemd/system/</Cmd>
        </li>
        <li>
          Vygenerovat token:
          <Cmd>openssl rand -hex 32</Cmd>
          Nevymýšlej ho z hlavy — kratší než 24 znaků endpoint odmítne a do
          logu napíše <code>drop_sync_token_too_short</code>.
        </li>
        <li>
          Ten samý token dát na <strong>dvě místa</strong> — do{" "}
          <code className="rounded bg-white px-1">.env</code> aplikace jako{" "}
          <code className="rounded bg-white px-1">DROP_SHEET_SYNC_TOKEN=…</code>{" "}
          a do souboru jen pro roota:
          <Cmd>
            sudo install -m 600 /dev/null /etc/ctyrlistkoteka-sync.env
          </Cmd>
          <Cmd>sudo nano /etc/ctyrlistkoteka-sync.env</Cmd>
          (dovnitř jediný řádek{" "}
          <code className="rounded bg-white px-1">DROP_SHEET_SYNC_TOKEN=…</code>)
        </li>
        <li>
          Načíst nový <code className="rounded bg-white px-1">.env</code> do
          běžící aplikace. <strong>To </strong>
          <code className="rounded bg-white px-1">source</code>
          <strong> na začátku tam patří</strong> — pm2 je z nvm a bez něj
          shell odpoví „command not found“:
          <Cmd>
            source /home/app/.nvm/nvm.sh &amp;&amp; pm2 reload ctyrlistkoteka
            --update-env
          </Cmd>
        </li>
        <li>
          Ověřit, že appka token vidí — <strong>200</strong> = dobrý,{" "}
          <strong>404</strong> = token nesedí nebo se appka nepřenačetla:
          <Cmd>
            curl -s -o /dev/null -w &quot;%&#123;http_code&#125;\n&quot; -X POST -H
            &quot;Authorization: Bearer TVUJ_TOKEN&quot;
            http://127.0.0.1:3000/api/admin/drops/sync
          </Cmd>
        </li>
        <li>
          Načíst unity a zkusit <strong>jeden běh ručně</strong>, ještě než
          se timer zapne:
          <Cmd>sudo systemctl daemon-reload</Cmd>
          <Cmd>sudo systemctl start drop-sheet-sync.service</Cmd>
          <Cmd>journalctl -u drop-sheet-sync.service -n 30 --no-pager</Cmd>
          (v logu čekej JSON s <code>checked</code>; <code>checked: 0</code>{" "}
          znamená jen, že žádná sada nemá zapnutý režim tabulky)
        </li>
        <li>
          Teprve teď zapnout timer:
          <Cmd>sudo systemctl enable --now drop-sheet-sync.timer</Cmd>
        </li>
        <li>
          Zkontrolovat, že tiká:
          <Cmd>systemctl list-timers drop-sheet-sync.timer --no-pager</Cmd>
          Za pár minut má v sekci výš zmizet fialové varování a{" "}
          <em>Naposled zkontrolováno</em> ukazovat čerstvý čas.
        </li>
      </ol>

      <p className="pt-1">
        Vypnout se dá kdykoli:{" "}
        <code className="rounded bg-white px-1">
          sudo systemctl disable --now drop-sheet-sync.timer
        </code>
        . Ruční tlačítko tím nijak netrpí.
      </p>

      <p className="pt-1 font-semibold text-gray-900">
        Proč se tou adresou nedá dostat dovnitř
      </p>
      <p>
        Maska adminu v Nginxu hlídá adresy začínající{" "}
        <code className="rounded bg-white px-1">/admin</code> — a tahle jimi
        nezačíná, takže se endpoint musí ubránit sám. Brání se čtyřikrát:
        přijímá <strong>jen volání z tohohle stroje</strong> (zvenku dostaneš
        404, i kdyby ses tvářil jako localhost — Nginx k hlavičce vždycky
        připojí tvoji skutečnou adresu a port 3000 stejně pouští firewall jen
        z loopbacku); <strong>token</strong> porovnává v konstantním čase, aby
        se nedal uhodnout po znacích; na jakékoli selhání odpovídá{" "}
        <strong>404</strong>, ne „špatné heslo“, takže se nedá ani zjistit, že
        tam něco je; a nakonec <strong>nic nepřijímá</strong> — nedá se mu
        podstrčit adresa ani data, stáhne jen odkaz, který sada už má, a jedině
        z <code className="rounded bg-white px-1">docs.google.com</code>.
        Nejhorší, co uniklý token svede, je vynutit stažení, které by stejně
        za pět minut proběhlo.
      </p>

      <p className="text-gray-500">
        Totéž je v repozitáři v <code className="rounded bg-white px-1">deploy/README.md</code>.
      </p>
    </div>
  );
}

/** A command line the operator will copy — monospace, its own row. */
function Cmd({ children }: { children: React.ReactNode }) {
  return (
    <code className="mt-1 block overflow-x-auto rounded border border-violet-200 bg-white px-2 py-1 font-mono text-[11px] text-gray-800">
      {children}
    </code>
  );
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
